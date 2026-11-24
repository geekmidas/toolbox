/**
 * The keys a workspace's stage must be given — across every app, each once,
 * with who reads it and whether the stage holds it.
 *
 * The keys themselves are `requiredStageKeys`'s, and the mail and storage
 * constructs `stageServiceDeclarations`' — the lists a deploy's readiness
 * check refuses a stage by. What this adds is the workspace: which third
 * parties' credentials its apps and workers read (`appEnvKeys`,
 * `workerEnvKeys`) and which of the keys the stage has set.
 */

import {
	type ConstructManifest,
	type MapsRole,
	providedKeyFor,
} from '@geekmidas/manifest';
import {
	type CredentialDeclaration,
	type MapsKeyDeclaration,
	requiredStageKeys,
	type StageKey,
	type StageProviderNotes,
	stageServiceDeclarations,
} from '../deploy/devServices';
import { appEnvKeys, workerEnvKeys } from '../reconcile/apps';
import { mapsHolders, storedMapsKey } from '../reconcile/mapsKeys.js';
import { appKey } from '../workspace/derive';

/** Whose a Maps key is, for the line that names it. */
const HOLDER: Record<MapsRole, string> = {
	apiKey: 'server',
	browserKey: 'browser',
	androidKey: 'Android',
	iosKey: 'iOS',
};

/** A stage key, and whether the stage's secrets hold it. */
export interface WorkspaceStageKey extends StageKey {
	set: boolean;
}

export interface WorkspaceStageKeysInput {
	manifest: ConstructManifest;
	/** Whether the stage is the workspace's local one. */
	local: boolean;
	/** What the stage's secrets hold, by key. */
	supplied: Readonly<Record<string, string>>;
	/** The stage's base domain, for the examples. */
	domain?: string;
	/** What the stage's providers say — a missing key's hint. */
	providers?: StageProviderNotes;
	/** The stage serves a domain from its own server: `GKM_SERVER_IPV4`. */
	server?: boolean;
}

/**
 * Every key the stage must be given: each mail and storage construct's —
 * the deploy's own list, `stageServiceDeclarations` — and each third party's
 * credentials an app reads.
 */
export function workspaceStageKeys(
	input: WorkspaceStageKeysInput,
): WorkspaceStageKey[] {
	const { manifest } = input;

	// What each process's environment holds: each app's, and each worker's —
	// whose crons and consumers run in a process of their own.
	const reads = new Map<string, Set<string>>();
	for (const [id, declaration] of Object.entries(manifest)) {
		const { kind } = declaration;
		const name = appKey(id);
		const keys =
			kind === 'rest-api' ||
			kind === 'websocket-api' ||
			kind === 'site' ||
			kind === 'mobile-app'
				? appEnvKeys(manifest, name)
				: kind === 'worker'
					? workerEnvKeys(manifest, id)
					: undefined;
		if (keys) reads.set(name, keys);
	}

	const readers = (id: string, kind: 'external-api' | 'credential') => {
		const key = providedKeyFor(id, kind, 'credentials');
		return [...reads]
			.filter(([, env]) => env.has(key))
			.map(([app]) => app)
			.sort();
	};

	const credentials: CredentialDeclaration[] = [];
	for (const [id, declaration] of Object.entries(manifest)) {
		const { kind } = declaration;
		if (kind !== 'external-api' && kind !== 'credential') continue;
		const apps = readers(id, kind);
		if (apps.length > 0) credentials.push({ id, kind, apps });
	}
	// Each Maps key some process holds (`mapsHolders`). A stage whose
	// provider makes them keeps one per caller; any other stage one per role,
	// set by hand and read by every caller of it.
	const perCaller = !input.local && input.providers?.maps !== undefined;
	const maps: MapsKeyDeclaration[] = [];
	const shared = new Map<string, MapsKeyDeclaration>();
	for (const holder of mapsHolders(manifest)) {
		const app = appKey(holder.caller);
		if (perCaller) {
			maps.push({
				id: holder.maps,
				key: storedMapsKey(holder, false),
				holder: HOLDER[holder.role],
				apps: [app],
			});
			continue;
		}
		const found = shared.get(holder.key);
		if (found) {
			found.apps = [...(found.apps ?? []), app].sort();
			continue;
		}
		const declaration: MapsKeyDeclaration = {
			id: holder.maps,
			key: holder.key,
			holder: HOLDER[holder.role],
			apps: [app],
		};
		shared.set(holder.key, declaration);
		maps.push(declaration);
	}
	// Mail and storage: the list a deploy's readiness check refuses by.
	const services = stageServiceDeclarations({
		manifest,
	});

	return requiredStageKeys({
		local: input.local,
		services,
		credentials,
		maps,
		...(input.domain ? { domain: input.domain } : {}),
		...(input.providers ? { providers: input.providers } : {}),
		...(input.server ? { server: true } : {}),
	}).map((key) => ({ ...key, set: input.supplied[key.key] !== undefined }));
}
