/**
 * `mobile: { provider: 'google-play' }` — what EAS Submit needs to publish
 * each `MobileApp` to Google Play, made by the deploy from the construct:
 * its `android.package`, its `eas.projectId`, and each stage's track.
 *
 * 1. Google: the project (`--project`, else `deploy.mobile.<stage>.project`,
 *    else `<workspace>-play`, made when absent) with the Android Publisher
 *    API on, and the service account `<workspace>-play` in it.
 * 2. Play Console: the account with a grant on each app alone, its
 *    permissions following the tracks every Play stage submits to —
 *    production releases only when one submits there. An app not in Play
 *    Console yet is a step only a person can take: with a terminal the
 *    deploy says what to create and waits; without one the app is left
 *    pending, and the rest of the deploy goes on.
 * 3. The key EAS Submit uses: kept while EAS holds one of the account's live
 *    keys for the app; otherwise — or with `--rotate-keys` — a new one,
 *    uploaded to EAS, assigned, and proved by opening and discarding an edit
 *    with it. Only then are the account's older keys deleted, from EAS and
 *    from Google, so a failed run leaves the old key working.
 * 4. The store listing kept beside the app (`store/play/`), pushed when it
 *    changed. An app Play has no build of yet refuses it: the deploy names
 *    the newest EAS store build to upload by hand.
 *
 * In CI — signed in through the Workload Identity credentials file — the
 * deploy only checks: granting Play access and issuing keys need a Play
 * Console admin and key admin, which a CI identity should not hold. A key
 * missing there is left pending, as `gkm publish` refuses to submit without
 * one; `--rotate-keys` there is an error.
 *
 * The account is one per workspace, and its key one for every app and
 * stage: each app's EAS credentials are given the same key.
 */

import { join } from 'node:path';
import type { MobileAppDeclaration } from '@geekmidas/manifest';
import { GkmError } from '../../errors';
import { mobileStage } from '../../mobile/stage.js';
import { stageProvider } from '../config.js';
import { type GoogleClient, googleClient } from '../google/client.js';
import {
	ANDROID_PUBLISHER_SCOPE,
	CLOUD_PLATFORM_SCOPE,
} from '../google/gcloud.js';
import { googleProject, holdGoogleProject } from '../google/project.js';
import {
	type GoogleCredential,
	googleProvisioningCredentials,
} from '../google/provisioning.js';
import {
	createKey,
	deleteKey,
	enableService,
	ensureProject,
	ensureServiceAccount,
	keyId,
	listKeys,
	type ServiceAccountKey,
	serviceAccountEmail,
} from '../google/resources.js';
import { constructsOf } from '../notes.js';
import type {
	EnsureContext,
	ResourceProvider,
	VerifyContext,
} from '../types.js';
import {
	checkGooglePlayConfig,
	GOOGLE_PLAY_PROVISIONING,
	type GooglePlayConfig,
} from './config.js';
import { type EasApi, type EasGoogleKey, easApi } from './easApi.js';
import {
	createAppSteps,
	ensurePlayAccess,
	PLAY_CONSOLE_CHECKLIST,
	PlayAppMissing,
	PlayKeyUnverified,
	playPermissions,
	playStoreDigest,
	pushPlayStore,
	readPlayStore,
	type ServiceAccountJson,
	verifyKey,
} from './play.js';

/** The API EAS Submit and gkm call Play through. */
export const ANDROID_PUBLISHER_API = 'androidpublisher.googleapis.com';

/** What the provider's sign-in carries: Cloud, and Play's own API. */
export const PLAY_SCOPES = [CLOUD_PLATFORM_SCOPE, ANDROID_PUBLISHER_SCOPE];

/** A mobile app with no Android package or EAS project on its construct. */
export class MobileAppStoreIdentityMissing extends GkmError {
	constructor(
		readonly app: string,
		readonly stage: string,
		readonly missing: 'android.package' | 'eas.projectId',
	) {
		super(
			`deploy.mobile.${stage} is google-play, and '${app}' has no ${missing} ` +
				'on its MobileApp: ' +
				(missing === 'android.package'
					? "Play knows an app by its package. Add android: { package: 'com.acme.shop' }, " +
						'the package its app.config.ts builds with.'
					: 'EAS keeps the key Play is published with on the project. Add ' +
						"eas: { projectId: '…' }, the id `eas init` linked the app to " +
						'(extra.eas.projectId in its Expo config).'),
		);
		this.name = 'MobileAppStoreIdentityMissing';
	}
}

/** Something only a deploy run by a person can do, asked of one in CI. */
export class PlaySetupNeedsPerson extends GkmError {
	constructor(
		readonly stage: string,
		readonly what: string,
	) {
		super(
			`Deploying '${stage}' from CI cannot ${what}: it needs a Play Console ` +
				'admin and key admin, which the CI identity does not hold. Run ' +
				`gkm deploy --stage ${stage}${what.includes('rotate') ? ' --rotate-keys' : ''} ` +
				'from a terminal, signed in as one.',
		);
		this.name = 'PlaySetupNeedsPerson';
	}
}

/**
 * An id Google accepts, from a workspace's name: `shop` → `shop-play`.
 * Lowercased, anything else made a hyphen, cut to 30. The default project
 * and the service account's name.
 */
export function playId(workspace: string): string {
	const base = workspace
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^[^a-z]+|-+$/g, '');
	return `${base.slice(0, 25).replace(/-+$/, '')}-play`;
}

/** How a mobile app is known to Play and to EAS. */
export interface StoreIdentity {
	app: MobileAppDeclaration;
	packageName: string;
	projectId: string;
}

/**
 * The mobile apps' store identities, from their constructs.
 *
 * @throws {MobileAppStoreIdentityMissing}
 */
export function storeIdentities(
	manifest: EnsureContext<GooglePlayConfig, unknown>['manifest'],
	stage: string,
): StoreIdentity[] {
	return constructsOf(manifest, 'mobile').map((id) => {
		const app = manifest[id] as MobileAppDeclaration;
		const packageName = app.android?.package;
		if (!packageName) {
			throw new MobileAppStoreIdentityMissing(id, stage, 'android.package');
		}
		const projectId = app.eas?.projectId;
		if (!projectId) {
			throw new MobileAppStoreIdentityMissing(id, stage, 'eas.projectId');
		}
		return { app, packageName, projectId };
	});
}

/**
 * The tracks an app is submitted to by every stage Play publishes it from:
 * the grant follows all of them, whichever stage is deploying.
 */
export function playTracks(
	workspace: EnsureContext<GooglePlayConfig, unknown>['workspace'],
	app: MobileAppDeclaration,
) {
	return workspace.stages.deployed
		.filter((stage) => {
			const choice = stageProvider(workspace, 'mobile', stage);
			return choice.mode === 'provider' && choice.name === 'google-play';
		})
		.map((stage) => mobileStage(workspace, app, stage).android.track);
}

/** The provider's provisioning credential: Google, and EAS. */
export interface GooglePlayCredential {
	google: GoogleCredential;
	eas: EasApi;
}

/** What the provider needs from outside the process, so tests can stand in. */
export interface GooglePlayDeps {
	/** EAS, with an access token. */
	eas: (token: string) => EasApi;
	/** Wait between two looks for the app, and two tries of the new key. */
	sleep: (ms: number) => Promise<void>;
}

const defaultDeps: GooglePlayDeps = {
	eas: (token) => easApi(token),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** An app's EAS project and Android credentials. */
interface EasApp extends StoreIdentity {
	account: { id: string; name: string };
	fullName: string;
	credentials: { id: string; submissionsKey?: EasGoogleKey };
}

export function createGooglePlayProvider(
	deps: GooglePlayDeps = defaultDeps,
): ResourceProvider<GooglePlayConfig, GooglePlayCredential> {
	async function easApps(
		eas: EasApi,
		identities: readonly StoreIdentity[],
	): Promise<EasApp[]> {
		const apps: EasApp[] = [];
		for (const identity of identities) {
			const project = await eas.project(identity.projectId);
			const credentials = await eas.androidCredentials(
				{ projectId: identity.projectId, fullName: project.fullName },
				identity.packageName,
			);
			apps.push({
				...identity,
				account: { id: project.accountId, name: project.accountName },
				fullName: project.fullName,
				credentials,
			});
		}
		return apps;
	}

	/** Whether EAS submits the app with one of the account's live keys. */
	const keyed = (app: EasApp, email: string, live: readonly string[]) => {
		const key = app.credentials.submissionsKey;
		return (
			key !== undefined &&
			key.clientEmail === email &&
			live.includes(key.privateKeyIdentifier)
		);
	};

	/** CI: what is there, checked; nothing a person must do is attempted. */
	async function checkFromCi(
		ctx: EnsureContext<GooglePlayConfig, GooglePlayCredential>,
		client: GoogleClient,
		project: string,
		identities: readonly StoreIdentity[],
	): Promise<void> {
		if (ctx.rotateKeys) {
			throw new PlaySetupNeedsPerson(ctx.stage, "rotate EAS Submit's Play key");
		}
		const email = serviceAccountEmail(project, playId(ctx.workspace.name));
		const live = (await listKeys(client, project, email)).map(keyId);
		for (const app of await easApps(ctx.credential.eas, identities)) {
			if (keyed(app, email, live)) {
				ctx.log(
					`   ${app.packageName}: EAS Submit's key is ${email}'s, and live`,
				);
				continue;
			}
			ctx.log(
				`   ⏳ ${app.packageName}: EAS has no live key of ${email} to submit with — ` +
					`pending until gkm deploy --stage ${ctx.stage} runs from a terminal, ` +
					'signed in as a Play Console admin. gkm publish refuses to submit until then.',
			);
		}
	}

	/** The app in Play Console with its grant; false when it is not there. */
	async function grant(
		ctx: EnsureContext<GooglePlayConfig, GooglePlayCredential>,
		client: GoogleClient,
		identity: StoreIdentity,
		email: string,
		listing: boolean,
	): Promise<boolean> {
		const permissions = playPermissions({
			tracks: playTracks(ctx.workspace, identity.app),
			listing,
		});
		for (let attempt = 0; ; attempt++) {
			try {
				const access = await ensurePlayAccess(client, {
					developer: ctx.config.developer,
					email,
					packageName: identity.packageName,
					permissions,
				});
				if (access !== 'unchanged') {
					await ctx.change(
						{
							construct: identity.app.id,
							resource: `Play access for ${email} on ${identity.packageName}`,
							change: `${access} (${permissions.join(', ')})`,
						},
						async () => {},
					);
				}
				if (access === 'invited') {
					ctx.log('   Left to do in Play Console, by hand:');
					for (const item of PLAY_CONSOLE_CHECKLIST)
						ctx.log(`     [ ] ${item}`);
				}
				return true;
			} catch (error) {
				if (!(error instanceof PlayAppMissing)) throw error;
				if (!ctx.credential.google.interactive) {
					ctx.log(`   ⏳ ${identity.packageName}: pending — ${error.message}`);
					return false;
				}
				if (attempt === 0) ctx.log(`\n⏳ ${error.message}\n   Waiting for it…`);
				await deps.sleep(15_000);
			}
		}
	}

	/**
	 * One key for every app that has none of the account's live keys — or
	 * for every app, rotating — proved on each before the older ones go.
	 */
	async function issueKey(
		ctx: EnsureContext<GooglePlayConfig, GooglePlayCredential>,
		client: GoogleClient,
		project: string,
		email: string,
		apps: readonly EasApp[],
	): Promise<void> {
		const older = await listKeys(client, project, email);
		const live = older.map(keyId);
		const due = ctx.rotateKeys
			? apps
			: apps.filter((app) => !keyed(app, email, live));
		if (due.length === 0) {
			for (const app of apps) {
				ctx.log(
					`   ${app.packageName}: EAS Submit's key is ${email}'s, and live`,
				);
			}
			return;
		}

		const key: ServiceAccountKey = await createKey(client, project, email);
		const json = JSON.parse(key.json!) as ServiceAccountJson &
			Record<string, unknown>;
		const { eas } = ctx.credential;

		// Every app gets the new key — one per EAS account it lives in — so
		// the older ones can go without leaving any app without one.
		const uploaded = new Map<string, string>();
		for (const app of apps) {
			let easKey = uploaded.get(app.account.id);
			if (!easKey) {
				easKey = (await eas.createKey(app.account.id, json)).id;
				uploaded.set(app.account.id, easKey);
			}
			await eas.assignForSubmissions(app.credentials.id, easKey);
		}

		// A new grant, and a new key, take a moment to reach Play.
		for (const app of apps) {
			for (let attempt = 0; ; attempt++) {
				try {
					await verifyKey(json, app.packageName);
					break;
				} catch (error) {
					if (!(error instanceof PlayKeyUnverified) || attempt >= 5)
						throw error;
					await deps.sleep(10_000);
				}
			}
		}
		await ctx.change(
			{
				construct: due.map((app) => app.app.id).join(', '),
				resource: `EAS Submit key of ${email}`,
				change: `issue ${keyId(key)}, proved on ${apps.map((app) => app.packageName).join(', ')}`,
			},
			async () => {},
		);

		const accounts = [...new Set(apps.map((app) => app.account.name))];
		let deleted = 0;
		for (const account of accounts) {
			for (const old of await eas.keys(account)) {
				if (old.clientEmail !== email) continue;
				if ([...uploaded.values()].includes(old.id)) continue;
				await eas.deleteKey(old.id);
				deleted++;
			}
		}
		for (const old of older) await deleteKey(client, old);
		if (older.length + deleted > 0) {
			ctx.log(
				`   🧹 deleted ${older.length} older key(s) from Google, ${deleted} from EAS`,
			);
		}
	}

	/** The listing, pushed when it changed; the first upload, named. */
	async function listing(
		ctx: EnsureContext<GooglePlayConfig, GooglePlayCredential>,
		client: GoogleClient,
		identity: StoreIdentity,
	): Promise<void> {
		const store = readPlayStore(
			join(ctx.workspace.root, identity.app.app.path),
		);
		if (!store) return;
		const digest = playStoreDigest(store);
		const entry = {
			key: `google-play-listing:${identity.app.id}`,
			type: 'google-play-listing',
		};
		if (ctx.state.record(entry.key)?.id === digest) return;

		const pushed = await pushPlayStore(client, identity.packageName, store);
		if (pushed.listing || pushed.dataSafety) {
			await ctx.change(
				{
					construct: identity.app.id,
					resource: `Play store listing of ${identity.packageName}`,
					change: [
						pushed.listing ? 'push the listing' : undefined,
						pushed.dataSafety ? 'push data safety' : undefined,
					]
						.filter(Boolean)
						.join(', '),
				},
				async () => {},
			);
		}
		if (pushed.reason) {
			ctx.log(
				`   ⏳ ${identity.packageName}: the listing waits for the app's first upload (${pushed.reason}).`,
			);
			const build = await ctx.credential.eas.latestStoreBuild(
				identity.projectId,
			);
			ctx.log(
				build
					? `   Upload the newest EAS store build by hand — ${build.url} — in Play Console: ${createAppSteps(identity.packageName)}`
					: `   EAS has no Android store build of it yet: run gkm publish --stage ${ctx.stage} --platform android --build, then upload its .aab by hand in Play Console.`,
			);
			return;
		}
		await ctx.state.pending(entry);
		await ctx.state.ready(entry, digest);
	}

	return {
		kind: 'mobile',
		cloud: 'google',
		name: 'google-play',
		check: checkGooglePlayConfig,
		provisioning: GOOGLE_PLAY_PROVISIONING,

		async credentials(lookup) {
			const token = lookup.env.EXPO_TOKEN;
			if (!token) return undefined;
			const google = await googleProvisioningCredentials(lookup, {
				scopes: PLAY_SCOPES,
			});
			return google ? { google, eas: deps.eas(token) } : undefined;
		},

		// Nothing is written into the stage's secrets: EAS holds the key.
		runtimeKeys: () => [],

		async ensure(ctx) {
			const identities = storeIdentities(ctx.manifest, ctx.stage);
			if (identities.length === 0) return;
			const { google } = ctx.credential;
			const project = googleProject({
				flag: google.project,
				configured: ctx.config.project ?? playId(ctx.workspace.name),
				workspace: ctx.workspace.name,
				stage: ctx.stage,
			});
			await holdGoogleProject(ctx.state, {
				stage: ctx.stage,
				kind: 'mobile',
				project,
				...(ctx.dryRun ? { dryRun: true } : {}),
			});

			if (ctx.dryRun) {
				for (const identity of identities) {
					await ctx.change(
						{
							construct: identity.app.id,
							resource: `Google Play publishing of ${identity.packageName} (project ${project})`,
							change: google.source === 'file' ? 'check' : 'set up',
						},
						async () => {},
					);
				}
				return;
			}

			const token = await google.signIn.token({
				interactive: google.interactive,
				scopes: PLAY_SCOPES,
			});
			const client = googleClient(token, project);
			if (google.source === 'file') {
				await checkFromCi(ctx, client, project, identities);
				return;
			}

			const created = await ensureProject(
				googleClient(token),
				project,
				`${ctx.workspace.name} Play`,
			);
			if (created) {
				await ctx.change(
					{
						construct: 'mobile',
						resource: `Google Cloud project ${project}`,
						change: 'create',
					},
					async () => {},
				);
			}
			await enableService(client, project, ANDROID_PUBLISHER_API);
			const email = await ensureServiceAccount(
				client,
				project,
				playId(ctx.workspace.name),
				`${ctx.workspace.name} publishing (gkm)`,
			);

			const ready: StoreIdentity[] = [];
			for (const identity of identities) {
				const store = readPlayStore(
					join(ctx.workspace.root, identity.app.app.path),
				);
				const listed = (store?.listings.length ?? 0) > 0;
				if (await grant(ctx, client, identity, email, listed)) {
					ready.push(identity);
				}
			}
			if (ready.length === 0) return;

			await issueKey(
				ctx,
				client,
				project,
				email,
				await easApps(ctx.credential.eas, ready),
			);
			for (const identity of ready) await listing(ctx, client, identity);
		},

		// What every deploy can check without signing in: each app says how
		// Play and EAS know it. The key itself is checked by `ensure()`.
		async verify(ctx: VerifyContext<GooglePlayConfig>) {
			storeIdentities(ctx.manifest, ctx.stage);
		},

		// CI only checks: it lists the publishing account's keys, in the
		// project it sends as the quota project. Granting in Play Console and
		// making a key are a person's, from a terminal — never CI's.
		ciGrants({ workspace, stage, config, project }) {
			const where = googleProject({
				flag: project,
				configured: config.project ?? playId(workspace.name),
				workspace: workspace.name,
				stage,
			});
			return [
				{ project: where, role: 'roles/serviceusage.serviceUsageConsumer' },
				{
					project: where,
					role: 'roles/iam.serviceAccountViewer',
					serviceAccount: serviceAccountEmail(where, playId(workspace.name)),
				},
			];
		},
	};
}

export const googlePlayProvider = createGooglePlayProvider();
