/**
 * The `google` provider for maps: a key for each caller of each `Maps`
 * construct, made in a Google Cloud project.
 *
 * `deploy.maps.<stage> = { provider: 'google', project?, android? }` has the
 * deploy:
 *
 * - find the project (`--project`, then `project`, then
 *   `<workspace>-<stage>`), and create it when it is not there; the first run
 *   records it in the stage's state, and a later one that resolves another
 *   stops (`holdGoogleProject`);
 * - turn on the APIs the construct names, and the API Keys API;
 * - stop unless billing is linked: Maps serves no project without it, and
 *   linking a billing account is a person's decision, never gkm's;
 * - for each process that holds a key (`mapsHolders`) find or create its own,
 *   restricted to the declared APIs and to that process alone — a server's to
 *   the stage's server address where it has one, a site's to its host, a
 *   mobile app's to its Android package and signing certificates or its iOS
 *   bundle id — and write it into the stage's secrets as the caller's own
 *   (`MAPS_BROWSER_KEY__WEB`), which the caller reads as `MAPS_BROWSER_KEY`.
 *   A key's restrictions follow the graph on every deploy.
 *
 * A key the stage's secrets hold that gkm did not make is used as it is, and
 * nothing is made for it: a caller's own, or the role's name — one key for
 * every caller. `--rotate-keys` makes each key a successor; the old one is
 * deleted by the first deploy after the stage has run with the new one, or
 * at once with `--retire-old-keys` — as every other provider's keys. A key
 * whose caller left the graph, and one made for every caller of a kind
 * before each had its own, are retired the same way.
 */

import {
	type ConstructManifest,
	kebabCase,
	type MapsApi,
	type MapsDeclaration,
	type MapsRole,
	providedKeyFor,
} from '@geekmidas/manifest';
import { appHostOn } from '../../../compose/stack.js';
import {
	SERVER_IPV4_KEY,
	SERVER_IPV6_KEY,
} from '../../../compose/dnsConfig.js';
import { GkmError } from '../../../errors';
import {
	type MapsHolder,
	mapsHolders,
	mapsValue,
	storedMapsKey,
} from '../../../reconcile/mapsKeys.js';
import { NoDomainForStage } from '../../../target/dokploy/domain.js';
import { appKey } from '../../../workspace/derive.js';
import { stageProvider } from '../../config.js';
import { deploysWithCompose } from '../../dns.js';
import {
	type EasApi,
	easApi,
	sha1Fingerprint,
} from '../../googlePlay/easApi.js';
import type {
	EnsureContext,
	ResourceProvider,
	StateEntry,
	VerifyContext,
} from '../../types.js';
import { GoogleApiError, type GoogleClient, googleClient } from '../client.js';
import { CLOUD_PLATFORM_SCOPE } from '../gcloud.js';
import {
	GoogleProjectNotCreated,
	googleProject,
	holdGoogleProject,
} from '../project.js';
import {
	type GoogleCredential,
	googleProvisioningCredentials,
} from '../provisioning.js';
import {
	CLOUD_RESOURCE_MANAGER,
	ensureProject,
	SERVICE_USAGE,
} from '../resources.js';
import {
	checkGoogleMapsConfig,
	GOOGLE_MAPS_PROVISIONING,
	type GoogleMapsConfig,
} from './config.js';

export const API_KEYS = 'https://apikeys.googleapis.com/v2';
export const CLOUD_BILLING = 'https://cloudbilling.googleapis.com/v1';

/** The APIs every project the provider works in needs on. */
export const PROVIDER_SERVICES = [
	'apikeys.googleapis.com',
	'cloudbilling.googleapis.com',
];

/**
 * The Google services each API is, by the key that calls it. The map itself
 * is a different service in a page and in each phone SDK, and nothing a
 * server calls; the web services are the same service for every caller.
 */
const SERVICES: Readonly<
	Record<MapsApi, Readonly<Partial<Record<MapsRole, readonly string[]>>>>
> = {
	maps: {
		browserKey: ['maps-backend.googleapis.com'],
		androidKey: ['maps-android-backend.googleapis.com'],
		iosKey: ['maps-ios-backend.googleapis.com'],
	},
	'static-maps': every(['static-maps-backend.googleapis.com']),
	// The Places API (New), and the one the Maps JavaScript API's own places
	// library still calls.
	places: every(['places.googleapis.com', 'places-backend.googleapis.com']),
	geocoding: every(['geocoding-backend.googleapis.com']),
	routes: every(['routes.googleapis.com']),
};

function every(
	services: readonly string[],
): Record<MapsRole, readonly string[]> {
	return {
		apiKey: services,
		browserKey: services,
		androidKey: services,
		iosKey: services,
	};
}

/** The services a key of `role` calls, for `apis`. Sorted. */
export function servicesFor(
	apis: readonly MapsApi[],
	role: MapsRole,
): string[] {
	return [...new Set(apis.flatMap((api) => SERVICES[api][role] ?? []))].sort();
}

/** What a role is called in a key's id and name. */
const ROLE_LABEL: Record<MapsRole, string> = {
	apiKey: 'server',
	browserKey: 'browser',
	androidKey: 'android',
	iosKey: 'ios',
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Maps serves no project without a billing account linked to it. */
export class MapsBillingDisabled extends GkmError {
	constructor(readonly project: string) {
		super(
			`The Google Cloud project '${project}' has no billing account linked, ` +
				'and Maps answers no key in a project without one. Link one — ' +
				`https://console.cloud.google.com/billing/linkedaccount?project=${project} ` +
				'— and deploy again. gkm never links billing itself.',
		);
		this.name = 'MapsBillingDisabled';
	}
}

/** A server process depends on a `Maps` whose APIs no server calls. */
export class MapsServerKeyCallsNothing extends GkmError {
	constructor(
		readonly maps: string,
		readonly callers: readonly string[],
	) {
		super(
			`${callers.join(', ')} ${callers.length === 1 ? 'depends' : 'depend'} on '${maps}' ` +
				'from a server, and its only API is `maps` — the map itself, which a ' +
				"page or a phone draws. Add the web services the server calls (apis: ['geocoding', …]), " +
				'or drop the edge.',
		);
		this.name = 'MapsServerKeyCallsNothing';
	}
}

/** A site holds a browser key, and the stage gives it no host to allow. */
export class MapsSiteHasNoHost extends GkmError {
	constructor(
		readonly maps: string,
		readonly stage: string,
		readonly sites: readonly string[],
	) {
		super(
			`'${maps}' makes its browser key on '${stage}' for ${sites.join(', ')}, ` +
				`and the stage has no domain to say where ${sites.length === 1 ? 'it answers' : 'they answer'} — ` +
				'so the key could be restricted to no referrer, and a browser key restricted ' +
				`to none is anyone's. Set domains.${stage} in gkm.config.ts.`,
		);
		this.name = 'MapsSiteHasNoHost';
	}
}

/** A key mid-rotation is asked to rotate again. */
export class MapsRotationInProgress extends GkmError {
	constructor(
		readonly maps: string,
		readonly caller: string,
		readonly role: MapsRole,
		readonly stage: string,
	) {
		super(
			`'${maps}' already has ${caller}'s ${ROLE_LABEL[role]} key rotating on '${stage}': ` +
				`deploy '${stage}' once with the new key, or pass --retire-old-keys, ` +
				'before rotating again.',
		);
		this.name = 'MapsRotationInProgress';
	}
}

/**
 * A mobile app holds an Android key, and the stage names no certificate its
 * builds are signed with. Google restricts an Android key by package *and*
 * certificate, so a key restricted by neither is anyone's who unpacks the app.
 */
export class MapsAndroidKeyUnsigned extends GkmError {
	constructor(
		readonly maps: string,
		readonly app: string,
		readonly stage: string,
		/** The stage ships the app through Google Play, which re-signs it. */
		readonly play: boolean,
	) {
		super(
			`${app}'s Android key for '${maps}' on '${stage}' is restricted to the ` +
				'certificates its builds are signed with, and the stage names ' +
				(play ? "none of Play's: Play re-signs what it installs. " : 'none. ') +
				'Copy the SHA-1 from Play Console → Test and release → App integrity → ' +
				`App signing key certificate into deploy.maps.${stage}.android.sha1` +
				(play ? '.' : ", or set EXPO_TOKEN for the EAS keystore's to be read."),
		);
		this.name = 'MapsAndroidKeyUnsigned';
	}
}

/** A deploy's check: a key a caller holds is not in the stage's secrets. */
export class MapsNotProvisioned extends GkmError {
	constructor(
		readonly stage: string,
		readonly maps: string,
		readonly missing: readonly string[],
	) {
		super(
			`'${stage}' has no ${missing.join(', ')} for '${maps}'. ` +
				`Deploy it (gkm deploy --stage ${stage}) and the google provider ` +
				'creates and writes them.',
		);
		this.name = 'MapsNotProvisioned';
	}
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

/** Every `Maps` construct in the manifest. */
export function mapsConstructs(manifest: ConstructManifest): MapsDeclaration[] {
	return Object.values(manifest)
		.filter((d): d is MapsDeclaration => d.kind === 'maps')
		.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** An API key's restrictions, as the API Keys API states them. */
export interface KeyRestrictions {
	apiTargets: { service: string }[];
	browserKeyRestrictions?: { allowedReferrers: string[] };
	androidKeyRestrictions?: {
		allowedApplications: { packageName: string; sha1Fingerprint: string }[];
	};
	iosKeyRestrictions?: { allowedBundleIds: string[] };
	serverKeyRestrictions?: { allowedIps: string[] };
}

/** An API key, as the API Keys API answers. */
export interface ApiKey {
	name: string;
	displayName?: string;
	restrictions?: KeyRestrictions;
}

interface Operation {
	name?: string;
	done?: boolean;
	error?: { message?: string };
	response?: unknown;
}

/** An operation, polled until it is done: its response. */
async function operationResult<T>(
	client: GoogleClient,
	operation: Operation,
	options: { intervalMs?: number; attempts?: number } = {},
): Promise<T> {
	let current = operation;
	for (let attempt = 0; !current.done; attempt++) {
		if (attempt >= (options.attempts ?? 30)) break;
		await new Promise((resolve) =>
			setTimeout(resolve, options.intervalMs ?? 2_000),
		);
		current = await client.request('GET', `${API_KEYS}/${current.name}`);
	}
	if (!current.done || current.error) {
		throw new GoogleApiError(
			'GET',
			`${API_KEYS}/${current.name}`,
			500,
			current.error?.message ?? 'the operation did not finish',
		);
	}
	return current.response as T;
}

/** The project's number-scoped parent every key lives under. */
function keysParent(project: string): string {
	return `projects/${project}/locations/global`;
}

/** Restrictions compared regardless of order. */
function sameRestrictions(
	a: KeyRestrictions | undefined,
	b: KeyRestrictions,
): boolean {
	const canonical = (r: KeyRestrictions | undefined) =>
		JSON.stringify({
			api: (r?.apiTargets ?? []).map((t) => t.service).sort(),
			browser: [...(r?.browserKeyRestrictions?.allowedReferrers ?? [])].sort(),
			android: (r?.androidKeyRestrictions?.allowedApplications ?? [])
				.map((app) => `${app.packageName}/${app.sha1Fingerprint.toUpperCase()}`)
				.sort(),
			ios: [...(r?.iosKeyRestrictions?.allowedBundleIds ?? [])].sort(),
			server: [...(r?.serverKeyRestrictions?.allowedIps ?? [])].sort(),
		});
	return canonical(a) === canonical(b);
}

/** A key, or `undefined` when it is gone. */
async function getKey(
	client: GoogleClient,
	name: string,
): Promise<ApiKey | undefined> {
	try {
		return await client.request<ApiKey>('GET', `${API_KEYS}/${name}`);
	} catch (error) {
		if (error instanceof GoogleApiError && error.status === 404) {
			return undefined;
		}
		throw error;
	}
}

async function keyString(client: GoogleClient, name: string): Promise<string> {
	const { keyString } = await client.request<{ keyString: string }>(
		'GET',
		`${API_KEYS}/${name}/keyString`,
	);
	return keyString;
}

async function deleteKey(client: GoogleClient, name: string): Promise<void> {
	try {
		const operation = await client.request<Operation>(
			'DELETE',
			`${API_KEYS}/${name}`,
		);
		if (!operation.done && operation.name) {
			await operationResult(client, operation);
		}
	} catch (error) {
		if (error instanceof GoogleApiError && error.status === 404) return;
		throw error;
	}
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export interface GoogleMapsDeps {
	/** A key's id must be new each time it is made: a deleted id is held for 30 days. */
	now(): number;
	/** Between two looks at an operation. */
	intervalMs?: number;
	/**
	 * EAS, to read the SHA-1 of the keystores a mobile app's builds are signed
	 * with — `undefined` without an `EXPO_TOKEN`, and then only the stage's
	 * configured certificates restrict its Android key.
	 */
	eas?: () => EasApi | undefined;
}

type Ctx = EnsureContext<GoogleMapsConfig, GoogleCredential>;

/** The state entry a caller's key is recorded under. */
export function keyEntryKey(
	maps: string,
	role: MapsRole,
	caller: string,
): string {
	return `maps-key:${maps}:${ROLE_LABEL[role]}:${caller}`;
}

/** The prefix every key the provider records is under. */
const KEY_ENTRY = 'maps-key:';

/** What a recorded key was made for: a caller's, or a role's for every caller. */
function recordedFor(
	key: string,
): { maps: string; role: MapsRole; caller?: string } | undefined {
	const [, maps, label, caller] = key.split(':');
	const role = (Object.keys(ROLE_LABEL) as MapsRole[]).find(
		(r) => ROLE_LABEL[r] === label,
	);
	if (!maps || !role) return undefined;
	return { maps, role, ...(caller ? { caller } : {}) };
}

/**
 * The referrer a site's browser key allows: its host on the stage, as the
 * stack answers it (`appHostOn`) — the local edge's name locally.
 */
function referrer(ctx: Ctx, maps: string, site: string): string {
	try {
		const host = appHostOn(ctx.workspace, ctx.manifest, ctx.stage, site);
		if (host) return `https://${host}/*`;
	} catch (error) {
		if (!(error instanceof NoDomainForStage)) throw error;
	}
	throw new MapsSiteHasNoHost(maps, ctx.stage, [site]);
}

/**
 * The SHA-1s an Android key is restricted to for `app`: the stage's
 * configured ones — Play's app-signing certificate — and each keystore EAS
 * signs its builds with.
 *
 * @throws {MapsAndroidKeyUnsigned} when there are none, or when the stage
 *   ships the app through Play and names none of Play's.
 */
async function signingCertificates(
	ctx: Ctx,
	deps: GoogleMapsDeps,
	maps: string,
	app: string,
	identity: { package: string; projectId?: string },
): Promise<string[]> {
	const configured = (ctx.config.android?.sha1 ?? []).map(sha1Fingerprint);
	const eas = identity.projectId ? (deps.eas ?? defaultEas)() : undefined;
	const fromEas =
		eas && identity.projectId
			? await eas.keystoreSha1s(identity.projectId, identity.package)
			: [];
	const mobile = stageProvider(ctx.workspace, 'mobile', ctx.stage);
	const play = mobile.mode === 'provider' && mobile.name === 'google-play';
	if (configured.length === 0 && (play || fromEas.length === 0)) {
		throw new MapsAndroidKeyUnsigned(maps, app, ctx.stage, play);
	}
	return [...new Set([...configured, ...fromEas])].sort();
}

/** EAS with the environment's `EXPO_TOKEN`, where there is one. */
function defaultEas(): EasApi | undefined {
	return process.env.EXPO_TOKEN ? easApi(process.env.EXPO_TOKEN) : undefined;
}

/**
 * The addresses a server key is restricted to: the stage's server's, on a
 * stage that runs on one. Elsewhere — a function with no fixed outbound
 * address — none, and the key is restricted to its APIs alone.
 */
function serverAddresses(ctx: Ctx): string[] {
	if (!deploysWithCompose(ctx.workspace)) return [];
	return [ctx.secrets[SERVER_IPV4_KEY], ctx.secrets[SERVER_IPV6_KEY]].filter(
		(address): address is string => Boolean(address),
	);
}

/**
 * What `holder`'s key is restricted to: the declared APIs it can call, and
 * the one caller that holds it.
 */
async function restrictionsOf(
	ctx: Ctx,
	deps: GoogleMapsDeps,
	maps: MapsDeclaration,
	holder: MapsHolder,
): Promise<KeyRestrictions> {
	const apiTargets = servicesFor(maps.apis, holder.role).map((service) => ({
		service,
	}));
	const app = ctx.manifest[holder.caller];
	switch (holder.role) {
		case 'apiKey': {
			const allowedIps = serverAddresses(ctx);
			return allowedIps.length > 0
				? { apiTargets, serverKeyRestrictions: { allowedIps } }
				: { apiTargets };
		}
		case 'browserKey':
			return {
				apiTargets,
				browserKeyRestrictions: {
					allowedReferrers: [referrer(ctx, maps.id, holder.caller)],
				},
			};
		case 'androidKey': {
			const android = app?.kind === 'mobile-app' ? app.android : undefined;
			const projectId =
				app?.kind === 'mobile-app' ? app.eas?.projectId : undefined;
			const packageName = android?.package ?? '';
			const sha1s = await signingCertificates(
				ctx,
				deps,
				maps.id,
				holder.caller,
				{ package: packageName, ...(projectId ? { projectId } : {}) },
			);
			return {
				apiTargets,
				androidKeyRestrictions: {
					allowedApplications: sha1s.map((sha1Fingerprint) => ({
						packageName,
						sha1Fingerprint,
					})),
				},
			};
		}
		case 'iosKey': {
			const ios = app?.kind === 'mobile-app' ? app.ios : undefined;
			return {
				apiTargets,
				iosKeyRestrictions: {
					allowedBundleIds: ios ? [ios.bundleIdentifier] : [],
				},
			};
		}
	}
}

/** The id a new key is made under: unique, as a deleted id is held for 30 days. */
function newKeyId(deps: GoogleMapsDeps, holder: MapsHolder): string {
	const suffix = deps.now().toString(36);
	const base =
		`${kebabCase(holder.maps)}-${kebabCase(holder.caller)}-${ROLE_LABEL[holder.role]}`
			.slice(0, 62 - suffix.length)
			.replace(/-+$/, '');
	return `${base}-${suffix}`;
}

/**
 * One caller's key: adopted when the stage set it by hand, its restrictions
 * kept in step with the graph, made when it is missing, rotated when asked —
 * and the rotated-out one deleted once the stage has run with its successor.
 */
async function ensureKey(
	ctx: Ctx,
	deps: GoogleMapsDeps,
	client: GoogleClient,
	input: {
		project: string;
		holder: MapsHolder;
		restrictions: KeyRestrictions;
	},
): Promise<void> {
	const { project, holder, restrictions } = input;
	const { maps, role, caller } = holder;
	const secret = storedMapsKey(holder, false);
	const entryKey = keyEntryKey(maps, role, caller);
	const record = ctx.state.record(entryKey);
	const held = ctx.secrets[secret];

	if (!record) {
		if (held !== undefined) {
			ctx.log(
				`   ${maps}: ${secret} is set in the stage's secrets — ${caller} uses that, and no key is made for it`,
			);
			return;
		}
		// The role's name set by hand — and not by an earlier provider run,
		// which recorded it — is one key every caller reads.
		const shared = providedKeyFor(maps, 'maps', role);
		const sharedRecord = ctx.state.record(
			`${KEY_ENTRY}${maps}:${ROLE_LABEL[role]}`,
		);
		if (ctx.secrets[shared] !== undefined && !sharedRecord) {
			ctx.log(
				`   ${maps}: ${shared} is set in the stage's secrets — ${caller} uses that, and no key is made for it`,
			);
			return;
		}
	}

	let current = record?.status === 'ready' ? record.id : undefined;
	let previous =
		typeof record?.data?.previous === 'string'
			? record.data.previous
			: undefined;
	const rotatedAt =
		typeof record?.data?.rotatedAt === 'string'
			? record.data.rotatedAt
			: undefined;
	const entry = (data: Record<string, unknown> = {}): StateEntry => ({
		key: entryKey,
		type: 'maps-key',
		data: { project, ...data },
	});
	const label = `${caller}'s ${ROLE_LABEL[role]} key`;

	if (previous && current) {
		if (ctx.retireOldKeys || hasRunSince(ctx, rotatedAt)) {
			const old = previous;
			const keep = current;
			await ctx.change(
				{
					construct: maps,
					resource: old,
					change: `delete the rotated-out ${label}`,
				},
				async () => {
					await deleteKey(client, old);
					await ctx.state.ready(entry(), keep);
				},
			);
			previous = undefined;
		} else {
			ctx.log(
				`   ${maps}: the old ${label} stays until '${ctx.stage}' is deployed with the new one; the next deploy after that deletes it (or pass --retire-old-keys)`,
			);
		}
	}

	const found = current ? await getKey(client, current) : undefined;
	if (!found) current = undefined;
	const valid =
		found !== undefined &&
		held !== undefined &&
		held === (await keyString(client, found.name));

	if (valid && !ctx.rotateKeys) {
		if (!sameRestrictions(found.restrictions, restrictions)) {
			await ctx.change(
				{
					construct: maps,
					resource: found.name,
					change: `restrict the ${label} to what calls it now`,
				},
				async () => {
					const operation = await client.request<Operation>(
						'PATCH',
						`${API_KEYS}/${found.name}?updateMask=restrictions`,
						{ restrictions },
					);
					if (!operation.done) {
						await operationResult(client, operation, intervalOf(deps));
					}
				},
			);
		}
		return;
	}
	if (ctx.rotateKeys && previous) {
		throw new MapsRotationInProgress(maps, caller, role, ctx.stage);
	}

	const outgoing = valid ? current : undefined;
	const why = !found
		? `create the ${label}`
		: ctx.rotateKeys
			? `rotate: make a new ${label}`
			: `make a new ${label} (the secrets no longer hold the recorded one)`;
	const keyId = newKeyId(deps, holder);
	await ctx.change(
		{
			construct: maps,
			resource: `${keysParent(project)}/keys/${keyId}`,
			change: why,
		},
		async () => {
			await ctx.state.pending(entry(outgoing ? { previous: outgoing } : {}));
			const operation = await client.request<Operation>(
				'POST',
				`${API_KEYS}/${keysParent(project)}/keys?keyId=${keyId}`,
				{
					displayName:
						`${maps}/${caller} ${ROLE_LABEL[role]} ${ctx.stage}`.slice(0, 63),
					restrictions,
				},
			);
			const created = await operationResult<ApiKey>(
				client,
				operation,
				intervalOf(deps),
			);
			// Into the stage's secrets before the record says it is ready: a key
			// the secrets do not hold is a key the next deploy replaces.
			await ctx.writeSecrets({
				[secret]: await keyString(client, created.name),
			});
			const issuedAt = new Date(deps.now()).toISOString();
			await ctx.state.ready(
				entry(outgoing ? { previous: outgoing, rotatedAt: issuedAt } : {}),
				created.name,
			);
		},
	);
}

/** Whether the stage has been deployed since `at`. */
function hasRunSince(ctx: Ctx, at: string | undefined): boolean {
	return (
		at !== undefined &&
		ctx.state.lastDeployedAt !== undefined &&
		ctx.state.lastDeployedAt > at
	);
}

function intervalOf(deps: GoogleMapsDeps): { intervalMs?: number } {
	return deps.intervalMs !== undefined ? { intervalMs: deps.intervalMs } : {};
}

/**
 * Each key the provider made that no caller holds now — one whose caller
 * left the graph, and one made for every caller of a kind before each had
 * its own: marked retired the first time it is seen, and deleted — from
 * Google, the state and the stage's secrets — once the stage has run without
 * it, or at once with `--retire-old-keys`.
 */
async function retireStaleKeys(
	ctx: Ctx,
	deps: GoogleMapsDeps,
	client: GoogleClient,
	wanted: ReadonlySet<string>,
): Promise<void> {
	const stale = Object.entries(ctx.state.records())
		.filter(([key]) => key.startsWith(KEY_ENTRY) && !wanted.has(key))
		.sort(([a], [b]) => a.localeCompare(b));
	for (const [key, record] of stale) {
		const made = recordedFor(key);
		if (!made) continue;
		const whose = made.caller
			? `${made.caller}'s ${ROLE_LABEL[made.role]} key`
			: `shared ${ROLE_LABEL[made.role]} key`;
		const retiredAt =
			typeof record.data?.retiredAt === 'string'
				? record.data.retiredAt
				: undefined;
		if (!ctx.retireOldKeys && !hasRunSince(ctx, retiredAt)) {
			if (retiredAt === undefined && record.id && !ctx.dryRun) {
				await ctx.state.ready(
					{
						key,
						type: 'maps-key',
						data: {
							...record.data,
							retiredAt: new Date(deps.now()).toISOString(),
						},
					},
					record.id,
				);
			}
			ctx.log(
				`   ${made.maps}: the ${whose} is no longer held; the first deploy after this one deletes it (or pass --retire-old-keys)`,
			);
			continue;
		}
		const secret = made.caller
			? storedMapsKey(
					{ maps: made.maps, role: made.role, caller: made.caller },
					false,
				)
			: providedKeyFor(made.maps, 'maps', made.role);
		const keys = [
			record.id,
			typeof record.data?.previous === 'string'
				? record.data.previous
				: undefined,
		].filter((id): id is string => Boolean(id));
		await ctx.change(
			{
				construct: made.maps,
				resource: keys[0] ?? key,
				change: `delete the ${whose}, which nothing holds`,
			},
			async () => {
				for (const id of keys) await deleteKey(client, id);
				await ctx.writeSecrets({ [secret]: null });
				await ctx.state.forget(key);
			},
		);
	}
}

/** Whether `project` exists, for the signed-in principal to see. */
async function projectExists(
	client: GoogleClient,
	project: string,
): Promise<boolean> {
	try {
		await client.request(
			'GET',
			`${CLOUD_RESOURCE_MANAGER}/projects/${project}`,
		);
		return true;
	} catch (error) {
		if (error instanceof GoogleApiError && [403, 404].includes(error.status)) {
			return false;
		}
		throw error;
	}
}

/** The services the project has on, of `wanted`. */
async function enabledServices(
	client: GoogleClient,
	project: string,
	wanted: readonly string[],
): Promise<Set<string>> {
	const enabled = new Set<string>();
	let pageToken: string | undefined;
	do {
		const page = await client.request<{
			services?: { config?: { name?: string } }[];
			nextPageToken?: string;
		}>(
			'GET',
			`${SERVICE_USAGE}/projects/${project}/services?filter=state:ENABLED&pageSize=200` +
				(pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''),
		);
		for (const service of page.services ?? []) {
			const name = service.config?.name;
			if (name && wanted.includes(name)) enabled.add(name);
		}
		pageToken = page.nextPageToken;
	} while (pageToken);
	return enabled;
}

export function createGoogleMapsProvider(
	deps: GoogleMapsDeps,
): ResourceProvider<GoogleMapsConfig, GoogleCredential> {
	async function ensure(ctx: Ctx): Promise<void> {
		const holders = mapsHolders(ctx.manifest);
		const stale = Object.keys(ctx.state.records()).some((key) =>
			key.startsWith(KEY_ENTRY),
		);
		if (holders.length === 0 && !stale) return;

		const project = googleProject({
			flag: ctx.credential.project,
			configured: ctx.config.project,
			workspace: ctx.workspace.name,
			stage: ctx.stage,
		});
		await holdGoogleProject(ctx.state, {
			stage: ctx.stage,
			kind: 'maps',
			project,
			dryRun: ctx.dryRun,
		});

		const token = await ctx.credential.signIn.token({
			interactive: ctx.credential.interactive,
			scopes: [CLOUD_PLATFORM_SCOPE],
		});
		const bare = googleClient(token);
		if (!(await projectExists(bare, project))) {
			if (ctx.credential.source === 'file') {
				throw new GoogleProjectNotCreated(ctx.stage, 'maps', project);
			}
			await ctx.change(
				{
					construct: 'maps',
					resource: `Google Cloud project ${project}`,
					change: 'create',
				},
				async () => {
					await ensureProject(
						bare,
						project,
						`${ctx.workspace.name} ${ctx.stage}`,
						{
							...(deps.intervalMs !== undefined
								? { intervalMs: deps.intervalMs }
								: {}),
						},
					);
				},
			);
			if (ctx.dryRun) return;
		}
		const client = googleClient(token, project);

		const declarations = new Map(
			mapsConstructs(ctx.manifest).map((maps) => [maps.id, maps]),
		);
		const wanted: { holder: MapsHolder; restrictions: KeyRestrictions }[] = [];
		for (const holder of holders) {
			const maps = declarations.get(holder.maps)!;
			if (
				holder.role === 'apiKey' &&
				servicesFor(maps.apis, 'apiKey').length === 0
			) {
				throw new MapsServerKeyCallsNothing(
					maps.id,
					holders
						.filter((h) => h.maps === maps.id && h.role === 'apiKey')
						.map((h) => h.caller),
				);
			}
			wanted.push({
				holder,
				restrictions: await restrictionsOf(ctx, deps, maps, holder),
			});
		}
		if (
			wanted.some(({ holder }) => holder.role === 'apiKey') &&
			serverAddresses(ctx).length === 0
		) {
			ctx.log(
				deploysWithCompose(ctx.workspace)
					? `   maps: '${ctx.stage}' has no ${SERVER_IPV4_KEY} yet — server keys are restricted to their APIs alone until it does`
					: `   maps: '${ctx.stage}' runs on no server with a fixed address — server keys are restricted to their APIs alone`,
			);
		}
		const services = [
			...new Set([
				...PROVIDER_SERVICES,
				...wanted.flatMap(({ restrictions }) =>
					restrictions.apiTargets.map((t) => t.service),
				),
			]),
		].sort();
		const enabled = await enabledServices(bare, project, services);
		const missing = services.filter((service) => !enabled.has(service));
		if (missing.length > 0) {
			await ctx.change(
				{
					construct: 'maps',
					resource: `Google Cloud project ${project}`,
					change: `turn on ${missing.join(', ')}`,
				},
				async () => {
					const operation = await bare.request<Operation>(
						'POST',
						`${SERVICE_USAGE}/projects/${project}/services:batchEnable`,
						{ serviceIds: missing },
					);
					if (!operation.done && operation.name) {
						let current = operation;
						for (let attempt = 0; !current.done && attempt < 30; attempt++) {
							await new Promise((resolve) =>
								setTimeout(resolve, deps.intervalMs ?? 2_000),
							);
							current = await bare.request<Operation>(
								'GET',
								`${SERVICE_USAGE}/${current.name}`,
							);
						}
					}
				},
			);
			if (ctx.dryRun) return;
		}

		const billing = await client.request<{ billingEnabled?: boolean }>(
			'GET',
			`${CLOUD_BILLING}/projects/${project}/billingInfo`,
		);
		if (!billing.billingEnabled) throw new MapsBillingDisabled(project);

		for (const { holder, restrictions } of wanted) {
			await ensureKey(ctx, deps, client, { project, holder, restrictions });
		}
		await retireStaleKeys(
			ctx,
			deps,
			client,
			new Set(
				wanted.map(({ holder }) =>
					keyEntryKey(holder.maps, holder.role, holder.caller),
				),
			),
		);
	}

	async function verify(ctx: VerifyContext<GoogleMapsConfig>): Promise<void> {
		for (const maps of mapsConstructs(ctx.manifest)) {
			const missing = mapsHolders(ctx.manifest, maps.id)
				.filter((holder) => mapsValue(ctx.secrets, holder, false) === undefined)
				.map((holder) => storedMapsKey(holder, false));
			if (missing.length > 0) {
				throw new MapsNotProvisioned(ctx.stage, maps.id, missing);
			}
		}
	}

	return {
		kind: 'maps',
		cloud: 'google',
		name: 'google',
		check: checkGoogleMapsConfig,
		provisioning: GOOGLE_MAPS_PROVISIONING,
		credentials: (lookup) => googleProvisioningCredentials(lookup),
		runtimeKeys(manifest) {
			return mapsHolders(manifest).map((holder) =>
				storedMapsKey(holder, false),
			);
		},
		ensure,
		verify,
		ciGrants({ workspace, stage, config, project }) {
			const where = googleProject({
				flag: project,
				configured: config.project,
				workspace: workspace.name,
				stage,
			});
			return MAPS_CI_ROLES.map((role) => ({ project: where, role }));
		},
	};
}

/**
 * What a deploy from CI does with the project, and the role each needs:
 * turn on the APIs (and send it as the quota project), make, restrict and
 * read keys, and read whether billing is linked.
 */
export const MAPS_CI_ROLES = [
	'roles/serviceusage.serviceUsageAdmin',
	'roles/serviceusage.apiKeysAdmin',
	'roles/browser',
] as const;

export const googleMapsProvider = createGoogleMapsProvider({
	now: () => Date.now(),
});
