/**
 * The `google` provider for maps: each `Maps` construct's keys, made in a
 * Google Cloud project.
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
 * - for each kind of caller the graph has (`mapsCallers`) find or create its
 *   key — the server's, restricted to the APIs; the sites', to their hosts as
 *   referrers too; a mobile app's, to its Android package and signing
 *   certificates, or to its iOS bundle id — and write it into the stage's
 *   secrets as `<ID>_API_KEY`, `<ID>_BROWSER_KEY`, `<ID>_ANDROID_KEY`,
 *   `<ID>_IOS_KEY`. A key's restrictions follow the graph on every deploy:
 *   add a site, and its host is allowed.
 *
 * A key the stage's secrets hold that gkm did not make is used as it is, and
 * nothing is made for it. `--rotate-keys` makes each key a successor; the old
 * one is deleted by the first deploy after the stage has run with the new
 * one, or at once with `--retire-old-keys` — as every other provider's keys.
 */

import {
	type ConstructManifest,
	kebabCase,
	type MapsApi,
	type MapsDeclaration,
	type MapsRole,
	mapsCallers,
	providedKeyFor,
} from '@geekmidas/manifest';
import { appHostOn } from '../../../compose/stack.js';
import { GkmError } from '../../../errors';
import { NoDomainForStage } from '../../../target/dokploy/domain.js';
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
		readonly role: MapsRole,
		readonly stage: string,
	) {
		super(
			`'${maps}' already has a ${ROLE_LABEL[role]} key rotating on '${stage}': ` +
				`deploy '${stage}' once with the new key, or pass --retire-old-keys, ` +
				'before rotating again.',
		);
		this.name = 'MapsRotationInProgress';
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

/** The keys the stage must hold for `maps`: one per role its callers hold. */
export function mapsKeys(
	manifest: ConstructManifest,
	maps: Pick<MapsDeclaration, 'id'>,
): string[] {
	return (Object.keys(mapsCallers(manifest, maps.id)) as MapsRole[])
		.sort()
		.map((role) => providedKeyFor(maps.id, 'maps', role));
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
}

type Ctx = EnsureContext<GoogleMapsConfig, GoogleCredential>;

/** The state entry a key is recorded under. */
export function keyEntryKey(maps: string, role: MapsRole): string {
	return `maps-key:${maps}:${ROLE_LABEL[role]}`;
}

/**
 * The referrers a browser key allows: each calling site's host on the stage,
 * as the stack answers it (`appHostOn`) — the local edge's name locally.
 */
function referrers(ctx: Ctx, maps: string, sites: readonly string[]): string[] {
	const allowed = new Set<string>();
	const unresolved: string[] = [];
	for (const id of sites) {
		try {
			const host = appHostOn(ctx.workspace, ctx.manifest, ctx.stage, id);
			if (host) allowed.add(`https://${host}/*`);
			else unresolved.push(id);
		} catch (error) {
			if (!(error instanceof NoDomainForStage)) throw error;
			unresolved.push(id);
		}
	}
	if (unresolved.length > 0) {
		throw new MapsSiteHasNoHost(maps, ctx.stage, unresolved);
	}
	return [...allowed].sort();
}

/** Each calling mobile app's identity, as its `MobileApp` declares it. */
function mobileIdentities(
	ctx: Ctx,
	apps: readonly string[],
): { packages: string[]; bundleIds: string[] } {
	const packages = new Set<string>();
	const bundleIds = new Set<string>();
	for (const id of apps) {
		const declaration = ctx.manifest[id];
		if (declaration?.kind !== 'mobile-app') continue;
		if (declaration.android) packages.add(declaration.android.package);
		if (declaration.ios) bundleIds.add(declaration.ios.bundleIdentifier);
	}
	return { packages: [...packages].sort(), bundleIds: [...bundleIds].sort() };
}

/** What each key the construct needs is restricted to. Absent: no key. */
function restrictionsFor(
	ctx: Ctx,
	maps: MapsDeclaration,
): Partial<Record<MapsRole, KeyRestrictions>> {
	const callers = mapsCallers(ctx.manifest, maps.id);
	const wanted: Partial<Record<MapsRole, KeyRestrictions>> = {};
	const targets = (role: MapsRole) =>
		servicesFor(maps.apis, role).map((service) => ({ service }));

	if (callers.apiKey) {
		if (targets('apiKey').length === 0) {
			throw new MapsServerKeyCallsNothing(maps.id, callers.apiKey);
		}
		wanted.apiKey = { apiTargets: targets('apiKey') };
	}
	if (callers.browserKey) {
		wanted.browserKey = {
			apiTargets: targets('browserKey'),
			browserKeyRestrictions: {
				allowedReferrers: referrers(ctx, maps.id, callers.browserKey),
			},
		};
	}
	const mobile = [
		...new Set([...(callers.androidKey ?? []), ...(callers.iosKey ?? [])]),
	];
	if (mobile.length > 0) {
		const { packages, bundleIds } = mobileIdentities(ctx, mobile);
		if (packages.length > 0) {
			const sha1 = ctx.config.android?.sha1 ?? [];
			if (sha1.length === 0) {
				ctx.log(
					`   ${maps.id}: no deploy.maps.${ctx.stage}.android.sha1 — the Android key is restricted to its APIs alone. Add the signing certificates' SHA-1 (Play Console → App integrity) to restrict it to ${packages.join(', ')}`,
				);
			}
			wanted.androidKey = {
				apiTargets: targets('androidKey'),
				...(sha1.length > 0
					? {
							androidKeyRestrictions: {
								allowedApplications: packages.flatMap((packageName) =>
									sha1.map((sha1Fingerprint) => ({
										packageName,
										sha1Fingerprint,
									})),
								),
							},
						}
					: {}),
			};
		} else {
			ctx.log(
				`   ${maps.id}: ${mobile.join(', ')} ${mobile.length === 1 ? 'has' : 'have'} no android.package on ${mobile.length === 1 ? 'its' : 'their'} MobileApp — no Android key is made`,
			);
		}
		if (bundleIds.length > 0) {
			wanted.iosKey = {
				apiTargets: targets('iosKey'),
				iosKeyRestrictions: { allowedBundleIds: bundleIds },
			};
		} else {
			ctx.log(
				`   ${maps.id}: ${mobile.join(', ')} ${mobile.length === 1 ? 'has' : 'have'} no ios.bundleIdentifier on ${mobile.length === 1 ? 'its' : 'their'} MobileApp — no iOS key is made`,
			);
		}
	}
	return wanted;
}

/**
 * One key: adopted when the stage set it by hand, its restrictions kept in
 * step with the graph, made when it is missing, rotated when asked — and the
 * rotated-out one deleted once the stage has run with its successor.
 */
async function ensureKey(
	ctx: Ctx,
	deps: GoogleMapsDeps,
	client: GoogleClient,
	input: {
		project: string;
		maps: string;
		role: MapsRole;
		restrictions: KeyRestrictions;
	},
): Promise<void> {
	const { project, maps, role, restrictions } = input;
	const secret = providedKeyFor(maps, 'maps', role);
	const entryKey = keyEntryKey(maps, role);
	const record = ctx.state.record(entryKey);
	const held = ctx.secrets[secret];

	if (!record && held !== undefined) {
		ctx.log(
			`   ${maps}: ${secret} is set in the stage's secrets — its callers use that, and no key is made for it`,
		);
		return;
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
	const label = `${ROLE_LABEL[role]} key`;

	if (previous && current) {
		const deployed =
			rotatedAt !== undefined &&
			ctx.state.lastDeployedAt !== undefined &&
			ctx.state.lastDeployedAt > rotatedAt;
		if (ctx.retireOldKeys || deployed) {
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
						await operationResult(client, operation, {
							...(deps.intervalMs !== undefined
								? { intervalMs: deps.intervalMs }
								: {}),
						});
					}
				},
			);
		}
		return;
	}
	if (ctx.rotateKeys && previous) {
		throw new MapsRotationInProgress(maps, role, ctx.stage);
	}

	const outgoing = valid ? current : undefined;
	const why = !found
		? `create the ${label}`
		: ctx.rotateKeys
			? `rotate: make a new ${label}`
			: `make a new ${label} (the secrets no longer hold the recorded one)`;
	const keyId =
		`${kebabCase(maps)}-${ROLE_LABEL[role]}-${deps.now().toString(36)}`
			.slice(0, 63)
			.replace(/-+$/, '');
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
					displayName: `gkm ${ctx.stage} ${maps} ${ROLE_LABEL[role]}`.slice(
						0,
						63,
					),
					restrictions,
				},
			);
			const created = await operationResult<ApiKey>(client, operation, {
				...(deps.intervalMs !== undefined
					? { intervalMs: deps.intervalMs }
					: {}),
			});
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
		const constructs = mapsConstructs(ctx.manifest).filter(
			(maps) => Object.keys(mapsCallers(ctx.manifest, maps.id)).length > 0,
		);
		if (constructs.length === 0) return;

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

		const wanted = new Map<
			string,
			Partial<Record<MapsRole, KeyRestrictions>>
		>();
		for (const maps of constructs) {
			wanted.set(maps.id, restrictionsFor(ctx, maps));
		}
		const services = [
			...new Set([
				...PROVIDER_SERVICES,
				...[...wanted.values()].flatMap((roles) =>
					Object.values(roles).flatMap((r) =>
						r.apiTargets.map((t) => t.service),
					),
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

		for (const maps of constructs) {
			const roles = wanted.get(maps.id) ?? {};
			for (const role of Object.keys(roles).sort() as MapsRole[]) {
				await ensureKey(ctx, deps, client, {
					project,
					maps: maps.id,
					role,
					restrictions: roles[role]!,
				});
			}
		}
	}

	async function verify(ctx: VerifyContext<GoogleMapsConfig>): Promise<void> {
		for (const maps of mapsConstructs(ctx.manifest)) {
			// A phone's key is made only for a platform its MobileApp declares,
			// so one the state does not record is not missing.
			const made = (role: MapsRole) =>
				(role !== 'androidKey' && role !== 'iosKey') ||
				ctx.resources === undefined ||
				ctx.resources[keyEntryKey(maps.id, role)] !== undefined;
			const missing = (
				Object.keys(mapsCallers(ctx.manifest, maps.id)) as MapsRole[]
			)
				.sort()
				.filter(made)
				.map((role) => providedKeyFor(maps.id, 'maps', role))
				.filter((key) => ctx.secrets[key] === undefined);
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
			return mapsConstructs(manifest).flatMap((maps) =>
				mapsKeys(manifest, maps),
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
