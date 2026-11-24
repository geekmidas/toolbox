/**
 * `gkm publish --stage <stage>`: a mobile app shipped for a deployed stage.
 *
 * First the stage's EAS project is synced (`gkm eas:sync`), so what is built
 * reads the stage's values. Then, per platform, the cheapest release that
 * gets the app's current code to the stage's users:
 *
 * - **An update**, when a store build with the same native code is already
 *   out: the fingerprint `runtimeVersion: { policy: 'fingerprint' }` gives a
 *   build is computed with the stage's profile, and a finished store build
 *   of that profile with that fingerprint means only JavaScript changed. It
 *   goes out on the stage's channel (`eas update`), which only builds of
 *   that runtime receive.
 * - **A store build**, otherwise, submitted to the store as the stage's
 *   submit profile says (`eas build --auto-submit`): Android to its Play
 *   track; iOS to App Store Connect once `submit.<stage>.ios.ascAppId` is
 *   set — without it, iOS is built and not submitted, and gkm says so,
 *   rather than leave a prompt nobody in CI can answer.
 *
 * `--build` or `--update` decides instead. An update with no store build to
 * receive it reaches nobody, so `--update` without one is refused.
 *
 * On a stage whose deploy sets the app up on Google Play
 * (`deploy.mobile.<stage>` is `google-play`), an Android store build is only
 * started once EAS holds the key to submit it with: without one EAS would
 * build it and fail at the end, so gkm says to deploy the stage instead.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GkmError } from '../errors';
import { type EasApi, easApi } from '../providers/googlePlay/easApi.js';
import { storeIdentities } from '../providers/googlePlay/index.js';
import {
	type EasCli,
	type EasPlatform,
	type EasSyncOptions,
	easCli,
	easSync,
} from './eas.js';

const logger = console;

/** `--update`, and no store build has this native code. */
export class NoStoreBuildForUpdate extends GkmError {
	constructor(
		readonly platform: EasPlatform,
		readonly stage: string,
		readonly fingerprint: string,
	) {
		super(
			`No ${platform} store build of '${stage}' has this native code ` +
				`(fingerprint ${fingerprint}), so an update would reach nobody: a phone ` +
				'only takes updates for the runtime it was built with. Build one: ' +
				`gkm publish --stage ${stage} --platform ${platform} --build.`,
		);
		this.name = 'NoStoreBuildForUpdate';
	}
}

/** An Android build for Play, and EAS holds no key to submit it with. */
export class PlaySubmitKeyMissing extends GkmError {
	constructor(
		readonly app: string,
		readonly stage: string,
		readonly packageName: string,
	) {
		super(
			`EAS holds no Google Play key to submit ${packageName} with, so a store ` +
				`build of '${app}' would be built and never submitted. Deploy the stage ` +
				`from a terminal, signed in as a Play Console admin — gkm deploy --stage ` +
				`${stage} — which sets it up (deploy.mobile.${stage} is google-play).`,
		);
		this.name = 'PlaySubmitKeyMissing';
	}
}

/** `--build` and `--update` together. */
export class PublishModeConflict extends GkmError {
	constructor() {
		super('Pass --build or --update, not both: one release per platform.');
		this.name = 'PublishModeConflict';
	}
}

export interface PublishOptions extends EasSyncOptions {
	/** `ios`, `android`, or both (the default). */
	platform?: EasPlatform | 'all';
	/** Build, or update, whatever the fingerprint says. */
	mode?: 'build' | 'update';
	/** Wait for a build to finish (and submit), rather than leave it on EAS. */
	wait?: boolean;
	/** The update's message: the commit's subject by default. */
	message?: string;
}

/** What one platform's release was — or, dry, would be. */
export interface PlatformRelease {
	platform: EasPlatform;
	fingerprint: string;
	/** The store build that already has this native code, if one does. */
	storeBuild?: string;
	release: 'build' | 'update';
	/** Whether a build is submitted to its store. */
	submit: boolean;
}

/**
 * Ship a mobile app for a deployed stage.
 *
 * @throws {NoStoreBuildForUpdate} — and what `easSync` throws
 */
export async function publish(
	options: PublishOptions,
	eas?: EasCli,
	/** EAS's API, where the Play key is checked. */
	easGraphql?: () => EasApi,
): Promise<PlatformRelease[]> {
	const synced = await easSync(options, eas);
	const cli = eas ?? easCli(synced.root, synced.values);
	const { dir, stage } = synced;
	const profile = stage.stage;

	const easJson = existsSync(join(dir, 'eas.json'))
		? (JSON.parse(readFileSync(join(dir, 'eas.json'), 'utf8')) as {
				submit?: Record<string, { ios?: { ascAppId?: string } }>;
			})
		: {};
	const iosSubmits = Boolean(easJson.submit?.[profile]?.ios?.ascAppId);

	const platforms: EasPlatform[] =
		!options.platform || options.platform === 'all'
			? ['ios', 'android']
			: [options.platform];

	const releases: PlatformRelease[] = [];
	for (const platform of platforms) {
		const fingerprint = await cli.fingerprint(dir, { platform, profile });
		const storeBuild =
			options.mode === 'build'
				? undefined
				: await cli.storeBuild(dir, { platform, profile, fingerprint });
		if (options.mode === 'update' && !storeBuild) {
			throw new NoStoreBuildForUpdate(platform, profile, fingerprint);
		}
		const release = options.mode ?? (storeBuild ? 'update' : 'build');
		const submit = platform === 'android' || iosSubmits;
		releases.push({
			platform,
			fingerprint,
			...(storeBuild ? { storeBuild } : {}),
			release,
			submit: release === 'build' && submit,
		});

		const why = storeBuild
			? `store build ${storeBuild} has this native code`
			: 'no store build has this native code';
		if (release === 'update') {
			logger.log(
				`🔁 ${platform}: an update on '${stage.channel}' (${why})${options.dryRun ? ' (dry run)' : ''}`,
			);
			if (options.dryRun) continue;
			await cli.update(dir, {
				platform,
				channel: stage.channel,
				environment: stage.environment,
				message: options.message ?? commitSubject(synced.root, profile),
			});
			continue;
		}

		const where =
			platform === 'android'
				? `submitted to Play's ${stage.android.track} track (${stage.android.releaseStatus})`
				: iosSubmits
					? 'submitted to App Store Connect'
					: `not submitted: submit.${profile}.ios.ascAppId is not set in eas.json`;
		logger.log(
			`📦 ${platform}: a store build of '${profile}', ${where} (${why})${options.dryRun ? ' (dry run)' : ''}`,
		);
		if (options.dryRun) continue;
		if (platform === 'android' && synced.play) {
			await assertPlaySubmitKey(synced, easGraphql ?? (() => easApi()));
		}
		await cli.build(dir, {
			platform,
			profile,
			submit,
			wait: options.wait ?? false,
		});
	}
	return releases;
}

/**
 * EAS holds a key to submit the app to Play with.
 *
 * @throws {PlaySubmitKeyMissing}, {MobileAppStoreIdentityMissing}
 */
async function assertPlaySubmitKey(
	synced: Awaited<ReturnType<typeof easSync>>,
	api: () => EasApi,
): Promise<void> {
	const [identity] = storeIdentities(
		{ [synced.declaration.id]: synced.declaration },
		synced.stage.stage,
	);
	const eas = api();
	const project = await eas.project(identity!.projectId);
	const credentials = await eas.androidCredentials(
		{ projectId: identity!.projectId, fullName: project.fullName },
		identity!.packageName,
	);
	if (!credentials.submissionsKey) {
		throw new PlaySubmitKeyMissing(
			synced.app,
			synced.stage.stage,
			identity!.packageName,
		);
	}
}

/** The current commit's subject, for an update's message. */
function commitSubject(root: string, stage: string): string {
	const result = spawnSync('git', ['log', '-1', '--format=%s'], {
		cwd: root,
		encoding: 'utf8',
	});
	const subject = result.status === 0 ? result.stdout.trim() : '';
	return subject || `gkm publish --stage ${stage}`;
}
