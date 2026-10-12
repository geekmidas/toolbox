/**
 * `gkm deploy:google-play`: what EAS Submit needs to publish a `MobileApp`
 * to Google Play, set up in one run — the counterpart of `gkm deploy:github`
 * for the AWS side.
 *
 * 1. Each deployed stage's track and release status into `eas.json`
 *    (`submit.<stage>.android`), from `mobileStage`.
 * 2. Google: the project (`--project`, else `<workspace>-play`, made when
 *    absent) with the Android Publisher API on, and the service account
 *    `<workspace>-play` in it, found or made.
 * 3. Play Console: the account invited with a grant on the app alone, its
 *    permissions following the stages' tracks — production releases only
 *    when a stage submits there. An app not in Play Console yet is a step
 *    only a person can take; interactively, the run says so and waits.
 * 4. A new JSON key, held in memory: uploaded to EAS, assigned to the app's
 *    Android credentials for EAS Submit, and proved by opening and
 *    discarding an edit with it. Only then are the account's older keys
 *    deleted, from EAS and from Google — a failed run leaves the old key
 *    working.
 * 5. The store listing kept beside the app (`store/play/`), pushed.
 * 6. What Play Console only takes by hand, as a checklist.
 *
 * Running it again rotates the key and pushes the listing.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { loadWorkspaceConfig } from '../../config.js';
import { GkmError } from '../../errors';
import { loadStage } from '../../exec/stage.js';
import { canPrompt } from '../../prompt.js';
import { chooseMobileApp, withStageProfiles } from '../eas.js';
import { mobileStage } from '../stage.js';
import { type EasApi, easApi } from './easApi.js';
import {
	assertGoogleId,
	createKey,
	deleteKey,
	enablePublisherApi,
	ensureProject,
	ensureServiceAccount,
	keyId,
	listKeys,
	playId,
} from './gcp.js';
import {
	type GoogleClient,
	type GoogleSignIn,
	gcloudSignIn,
	googleClient,
} from './google.js';
import {
	ensurePlayAccess,
	PLAY_CONSOLE_CHECKLIST,
	PlayAppMissing,
	PlayKeyUnverified,
	playPermissions,
	pushPlayStore,
	readPlayStore,
	type ServiceAccountJson,
	verifyKey,
} from './play.js';

const logger = console;

/** No Play developer account to act in. */
export class PlayDeveloperMissing extends GkmError {
	constructor() {
		super(
			'Name the Play developer account: --developer <id>. It is the number in ' +
				"Play Console's address: https://play.google.com/console/developers/<id>/….",
		);
		this.name = 'PlayDeveloperMissing';
	}
}

/** The app's Expo config has no Android package, or no EAS project. */
export class ExpoConfigIncomplete extends GkmError {
	constructor(
		readonly app: string,
		readonly missing: 'android.package' | 'extra.eas.projectId',
	) {
		super(
			missing === 'android.package'
				? `'${app}' has no android.package in its Expo config: Play knows an app ` +
						"by its package. Set it in app.config.ts: android: { package: 'com.acme.shop' }."
				: `'${app}' has no extra.eas.projectId in its Expo config: it is not ` +
						'linked to an EAS project. Run `eas init` in the app.',
		);
		this.name = 'ExpoConfigIncomplete';
	}
}

/** `expo config` could not read the app's config. */
export class ExpoConfigFailed extends GkmError {
	constructor(
		readonly dir: string,
		readonly detail: string,
	) {
		super(
			`Could not read the Expo config in ${dir} (${detail}). Check that ` +
				'`npx expo config --json` works there.',
		);
		this.name = 'ExpoConfigFailed';
	}
}

/** The workspace deploys no stage. */
export class NoDeployedStage extends GkmError {
	constructor() {
		super(
			'gkm.config.ts deploys no stage, so there is nothing to publish to: add one to stages.deployed.',
		);
		this.name = 'NoDeployedStage';
	}
}

/** What the run needs of the app's Expo config. */
export interface ExpoAppConfig {
	name?: string;
	android?: { package?: string };
	extra?: { eas?: { projectId?: string } };
}

export interface GooglePlayDeps {
	signIn: GoogleSignIn;
	eas: EasApi;
	/** The app's Expo config, evaluated with the values its build reads. */
	expoConfig: (
		dir: string,
		root: string,
		env: Readonly<Record<string, string>>,
	) => Promise<ExpoAppConfig>;
	/** Whether a person is here: to sign in, and to create the app. */
	interactive: boolean;
	/** Wait between two looks for the app, and two tries of the new key. */
	sleep: (ms: number) => Promise<void>;
}

/** `expo config --json`, run with the app's Expo — its own, or the workspace's. */
export function expoConfig(
	dir: string,
	root: string,
	env: Readonly<Record<string, string>>,
): Promise<ExpoAppConfig> {
	return new Promise((resolve, reject) => {
		const child = spawn('expo', ['config', '--json', '--type', 'public'], {
			cwd: dir,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				...env,
				PATH: [
					join(dir, 'node_modules', '.bin'),
					join(root, 'node_modules', '.bin'),
					process.env.PATH,
				].join(delimiter),
			},
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on('error', (error) =>
			reject(new ExpoConfigFailed(dir, error.message)),
		);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new ExpoConfigFailed(dir, stderr.trim() || `exit ${code}`));
				return;
			}
			try {
				resolve(JSON.parse(stdout) as ExpoAppConfig);
			} catch {
				reject(new ExpoConfigFailed(dir, `no JSON: ${stdout.slice(0, 200)}`));
			}
		});
	});
}

export const defaultGooglePlayDeps: GooglePlayDeps = {
	signIn: gcloudSignIn(),
	eas: easApi(),
	expoConfig,
	interactive: canPrompt(),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface GooglePlayOptions {
	/** The mobile app; the one here, or the only one, if not. */
	app?: string;
	/** The Google Cloud project: `<workspace>-play` by default. */
	project?: string;
	/** The Play developer account's id. */
	developer?: string;
	/**
	 * The stage whose values evaluate the app's Expo config: the protected
	 * one, else the first deployed.
	 */
	stage?: string;
	/** The AWS profile for that stage's account, where its secrets are kept. */
	profile?: string;
	cwd?: string;
}

export interface GooglePlayResult {
	packageName: string;
	project: string;
	email: string;
	permissions: string[];
	access: 'invited' | 'granted' | 'updated' | 'unchanged';
	/** The new key's id, in Google and in EAS. */
	key: { google: string; eas: string };
	/** The older keys deleted. */
	deleted: { google: string[]; eas: string[] };
	listing:
		| { listing: boolean; dataSafety: boolean; reason?: string }
		| undefined;
}

/**
 * Set up publishing a mobile app to Google Play.
 *
 * @throws {PlayDeveloperMissing}, {ExpoConfigIncomplete}, {PlayAppMissing},
 *   {PlayKeyUnverified} — and what each step's API throws
 */
export async function deployGooglePlay(
	options: GooglePlayOptions,
	deps: GooglePlayDeps = defaultGooglePlayDeps,
): Promise<GooglePlayResult> {
	if (!options.developer) throw new PlayDeveloperMissing();
	const developer = options.developer;

	// The stage only evaluates the Expo config: any deployed one's values do.
	const declared = (await loadWorkspaceConfig(options.cwd)).workspace.stages;
	const stageName =
		options.stage ?? declared.protected?.[0] ?? declared.deployed[0];
	if (!stageName) throw new NoDeployedStage();
	const loaded = await loadStage({
		stage: stageName,
		...(options.cwd ? { cwd: options.cwd } : {}),
		...(options.profile ? { profile: options.profile } : {}),
	});
	const { workspace, manifest, stack } = loaded;
	const declaration = chooseMobileApp(manifest, options.app, loaded.appName);
	const name = declaration.id;
	const dir = join(workspace.root, declaration.app.path);
	const values =
		stack.mobileApps.find((candidate) => candidate.id === declaration.id)
			?.values ?? {};

	const config = await deps.expoConfig(dir, workspace.root, values);
	const packageName = config.android?.package;
	if (!packageName) throw new ExpoConfigIncomplete(name, 'android.package');
	const projectId = config.extra?.eas?.projectId;
	if (!projectId) throw new ExpoConfigIncomplete(name, 'extra.eas.projectId');

	// 1. Each stage's track, in eas.json — and the tracks the grant follows.
	const stages = workspace.stages.deployed.map((stage) =>
		mobileStage(workspace, declaration, stage),
	);
	const easJsonPath = join(dir, 'eas.json');
	const before = existsSync(easJsonPath)
		? JSON.parse(await readFile(easJsonPath, 'utf8'))
		: {};
	const after = stages.reduce(withStageProfiles, before);
	if (JSON.stringify(before) !== JSON.stringify(after)) {
		await writeFile(easJsonPath, `${JSON.stringify(after, null, 2)}\n`);
		logger.log(`📝 ${easJsonPath}: each stage's build and submit profiles`);
	}
	const store = readPlayStore(dir);
	const permissions = playPermissions({
		tracks: stages.map((stage) => stage.android.track),
		listing: (store?.listings.length ?? 0) > 0,
	});

	// 2. Google: signed in as a Play Console admin, the project and account.
	const project = options.project ?? playId(workspace.name);
	assertGoogleId('project', project);
	const account = playId(workspace.name);
	const token = await deps.signIn.token({ interactive: deps.interactive });
	const bare: GoogleClient = googleClient(token);
	const created = await ensureProject(bare, project, `${workspace.name} Play`);
	logger.log(
		`☁️  Google Cloud project ${project}${created ? ' (created)' : ''}`,
	);
	const client = googleClient(token, project);
	await enablePublisherApi(client, project);
	const email = await ensureServiceAccount(
		client,
		project,
		account,
		`${workspace.name} publishing (gkm)`,
	);
	logger.log(`🤖 Service account ${email}`);

	// 3. Play Console: the app grant, waiting for the app where someone can
	// make it.
	let access: GooglePlayResult['access'] | undefined;
	for (let attempt = 0; !access; attempt++) {
		try {
			access = await ensurePlayAccess(client, {
				developer,
				email,
				packageName,
				permissions,
			});
		} catch (error) {
			if (!(error instanceof PlayAppMissing) || !deps.interactive) throw error;
			if (attempt === 0) {
				logger.log(`\n⏳ ${error.message}\n   Waiting for it…`);
			}
			await deps.sleep(15_000);
		}
	}
	logger.log(
		`🎟️  Play access on ${packageName}: ${access} (${permissions.join(', ')})`,
	);

	// 4. A new key: to EAS, proved, and only then the old ones gone.
	const older = await listKeys(client, project, email);
	const key = await createKey(client, project, email);
	const json = JSON.parse(key.json) as ServiceAccountJson &
		Record<string, unknown>;
	const easProject = await deps.eas.project(projectId);
	const credentials = await deps.eas.androidCredentials(
		{ projectId, fullName: easProject.fullName },
		packageName,
	);
	const easKey = await deps.eas.createKey(easProject.accountId, json);
	await deps.eas.useForSubmissions(credentials.id, easKey.id);
	logger.log(
		`🔑 New key ${keyId(key)} assigned to EAS Submit for ${packageName}`,
	);

	// A new grant takes a moment to reach Play.
	for (let attempt = 0; ; attempt++) {
		try {
			await verifyKey(json, packageName);
			break;
		} catch (error) {
			if (!(error instanceof PlayKeyUnverified) || attempt >= 5) throw error;
			await deps.sleep(10_000);
		}
	}
	logger.log('✅ The key opens an edit on the app');

	const easOlder = (await deps.eas.keys(easProject.accountName)).filter(
		(candidate) =>
			candidate.clientEmail === email && candidate.id !== easKey.id,
	);
	for (const old of easOlder) await deps.eas.deleteKey(old.id);
	for (const old of older) await deleteKey(client, old);
	if (older.length + easOlder.length > 0) {
		logger.log(
			`🧹 Deleted ${older.length} older key(s) from Google, ${easOlder.length} from EAS`,
		);
	}

	// 5. The listing, where the workspace keeps one.
	const listing = store
		? await pushPlayStore(client, packageName, store)
		: undefined;
	if (listing?.listing) logger.log('🛍️  Store listing pushed');
	if (store && !listing?.listing && listing?.reason) {
		logger.log(
			`⏭️  Store listing not pushed yet (${listing.reason}): run this again after the app's first upload`,
		);
	}
	if (listing?.dataSafety) logger.log('🛡️  Data safety pushed');

	// 6. What only a person can do.
	logger.log('\nLeft to do in Play Console, by hand:');
	for (const item of PLAY_CONSOLE_CHECKLIST) logger.log(`  [ ] ${item}`);

	return {
		packageName,
		project,
		email,
		permissions,
		access,
		key: { google: keyId(key), eas: easKey.id },
		deleted: {
			google: older.map(keyId),
			eas: easOlder.map((candidate) => candidate.id),
		},
		listing,
	};
}
