/**
 * Who holds each `Maps` key, and what one holder reads — the one walk every
 * place that makes, stores or hands out a Maps key takes.
 *
 * A holder is a process: a surface, a site, a mobile app, a worker, a file
 * server's processors, a function or cron no worker runs. It holds a key
 * because something it runs depends on the construct — read off the env keys
 * it is handed (`appEnvKeys`, `workerEnvKeys`, `processorEnvKeys`), so a key
 * is made for exactly the processes that read one.
 *
 * Every holder reads its key under the role's name (`MAPS_API_KEY`). Where
 * the value comes from:
 *
 * - **A local stage**: the role's name in its secrets, set by hand and read
 *   by every caller alike — there is no Google project making keys for it.
 * - **A deployed stage**: the caller's own key (`mapsKeyOf`,
 *   `MAPS_BROWSER_KEY_WEB`), which the google provider makes and restricts
 *   to that caller; and, where the stage holds none, the role's name — one key
 *   set by hand for every caller, on a stage with no provider.
 */

import {
	type ConstructManifest,
	dependenciesOf,
	isMapsCallerKey,
	MAPS_ROLES,
	type MapsRole,
	mapsKeyOf,
	providedKeyFor,
} from '@geekmidas/manifest';
import { appKey } from '../workspace/derive.js';
import { appEnvKeys, processorEnvKeys, workerEnvKeys } from './apps.js';

/** One process holding one key of one `Maps` construct. */
export interface MapsHolder {
	/** The `Maps` construct. */
	maps: string;
	role: MapsRole;
	/** The process's construct: a surface, site, mobile app, worker… */
	caller: string;
	/** The name it reads the key by: `MAPS_BROWSER_KEY`. */
	key: string;
}

/** The env keys each process reads, by the construct that is the process. */
function processKeys(
	manifest: ConstructManifest,
): Map<string, ReadonlySet<string>> {
	const processes = new Map<string, ReadonlySet<string>>();
	for (const [id, declaration] of Object.entries(manifest)) {
		switch (declaration.kind) {
			case 'rest-api':
			case 'websocket-api':
			case 'site':
			case 'mobile-app': {
				const keys = appEnvKeys(manifest, appKey(id));
				if (keys) processes.set(id, keys);
				break;
			}
			case 'worker': {
				const keys = workerEnvKeys(manifest, id);
				if (keys) processes.set(id, keys);
				break;
			}
			case 'file-server': {
				const keys = processorEnvKeys(manifest, id);
				if (keys) processes.set(id, keys);
				break;
			}
			// A function or cron no worker runs is a process of its own.
			case 'function':
			case 'cron': {
				if (declaration.owner) break;
				const keys = new Set<string>();
				for (const edge of dependenciesOf(declaration)) {
					if (manifest[edge.target]?.kind === 'maps') {
						keys.add(providedKeyFor(edge.target, 'maps', 'apiKey'));
					}
				}
				processes.set(id, keys);
				break;
			}
		}
	}
	return processes;
}

/**
 * Whether `caller` can hold a key of `role`: a mobile app holds a phone's
 * key only for a platform its `MobileApp` declares — there is nothing to
 * restrict one to otherwise, so none is made, and it reads none.
 */
function platformDeclared(
	manifest: ConstructManifest,
	caller: string,
	role: MapsRole,
): boolean {
	const app = manifest[caller];
	if (role === 'androidKey') {
		return app?.kind === 'mobile-app' && app.android !== undefined;
	}
	if (role === 'iosKey') {
		return app?.kind === 'mobile-app' && app.ios !== undefined;
	}
	return true;
}

/**
 * Every process holding a key of a `Maps` construct, by construct, role and
 * process — sorted. `maps` narrows it to one construct.
 */
export function mapsHolders(
	manifest: ConstructManifest,
	maps?: string,
): MapsHolder[] {
	const holders: MapsHolder[] = [];
	const processes = processKeys(manifest);
	for (const [id, declaration] of Object.entries(manifest)) {
		if (declaration.kind !== 'maps') continue;
		if (maps !== undefined && id !== maps) continue;
		for (const role of MAPS_ROLES) {
			const key = providedKeyFor(id, 'maps', role);
			for (const [caller, keys] of processes) {
				if (!keys.has(key) || !platformDeclared(manifest, caller, role)) {
					continue;
				}
				holders.push({ maps: id, role, caller, key });
			}
		}
	}
	return holders.sort(
		(a, b) =>
			a.maps.localeCompare(b.maps) ||
			MAPS_ROLES.indexOf(a.role) - MAPS_ROLES.indexOf(b.role) ||
			a.caller.localeCompare(b.caller),
	);
}

/**
 * Where the stage keeps `holder`'s key: the role's name on a local stage,
 * the caller's own key on a deployed one.
 */
export function storedMapsKey(
	holder: Pick<MapsHolder, 'maps' | 'role' | 'caller'>,
	local: boolean,
): string {
	return local
		? providedKeyFor(holder.maps, 'maps', holder.role)
		: mapsKeyOf(holder.maps, holder.role, holder.caller);
}

/**
 * The key `holder` reads, from the stage's secrets: its own where the stage
 * holds one, and otherwise the role's — the one key set by hand for every
 * caller. `undefined` when the stage holds neither.
 */
export function mapsValue(
	stored: Readonly<Record<string, string>>,
	holder: Pick<MapsHolder, 'maps' | 'role' | 'caller'>,
	local: boolean,
): string | undefined {
	return (
		stored[storedMapsKey(holder, local)] ??
		stored[providedKeyFor(holder.maps, 'maps', holder.role)]
	);
}

/**
 * The stage's secrets as the process `caller` reads them: each Maps key it
 * holds under its role's name, and no other caller's own key — what a target
 * that hands a process the stage's secrets by name hands it.
 */
export function callerSecrets(
	manifest: ConstructManifest,
	caller: string | undefined,
	stored: Readonly<Record<string, string>>,
	local: boolean,
): Record<string, string> {
	const secrets = Object.fromEntries(
		Object.entries(stored).filter(([key]) => !isMapsCallerKey(manifest, key)),
	);
	if (caller === undefined) return secrets;
	for (const holder of mapsHolders(manifest)) {
		if (holder.caller !== caller) continue;
		const value = mapsValue(stored, holder, local);
		if (value !== undefined) secrets[holder.key] = value;
	}
	return secrets;
}

/** The construct an app of the workspace is, by its name: `api` → `Api`. */
export function appCaller(
	manifest: ConstructManifest,
	appName: string,
): string | undefined {
	return Object.entries(manifest).find(
		([id, declaration]) =>
			(declaration.kind === 'rest-api' ||
				declaration.kind === 'websocket-api' ||
				declaration.kind === 'site' ||
				declaration.kind === 'mobile-app') &&
			appKey(id) === appName,
	)?.[0];
}
