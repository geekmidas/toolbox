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

import { type ConstructManifest, provideKey } from '@geekmidas/manifest';
import {
	type CredentialDeclaration,
	requiredStageKeys,
	type StageKey,
	type StageProviderNotes,
	stageServiceDeclarations,
} from '../deploy/devServices';
import { appEnvKeys, workerEnvKeys } from '../reconcile/apps';
import { appKey } from '../workspace/derive';

/** A stage key, and whether the stage's secrets hold it. */
export interface WorkspaceStageKey extends StageKey {
	set: boolean;
}

export interface WorkspaceStageKeysInput {
	manifest: ConstructManifest;
	/** Each owner's runnables' edges, from discovery. */
	runnables?: Readonly<Record<string, readonly string[]>>;
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
			kind === 'rest-api' || kind === 'site' || kind === 'mobile-app'
				? appEnvKeys(manifest, name, input.runnables)
				: kind === 'worker'
					? workerEnvKeys(manifest, id, input.runnables)
					: undefined;
		if (keys) reads.set(name, keys);
	}

	const readers = (id: string) => {
		const key = provideKey(id, 'credentials');
		return [...reads]
			.filter(([, env]) => env.has(key))
			.map(([app]) => app)
			.sort();
	};

	const credentials: CredentialDeclaration[] = [];
	for (const [id, declaration] of Object.entries(manifest)) {
		const { kind } = declaration;
		if (kind !== 'external-api' && kind !== 'credential') continue;
		const apps = readers(id);
		if (apps.length > 0) credentials.push({ id, kind, apps });
	}
	// Mail and storage: the list a deploy's readiness check refuses by.
	const services = stageServiceDeclarations({
		manifest,
		...(input.runnables ? { runnables: input.runnables } : {}),
	});

	return requiredStageKeys({
		local: input.local,
		services,
		credentials,
		...(input.domain ? { domain: input.domain } : {}),
		...(input.providers ? { providers: input.providers } : {}),
		...(input.server ? { server: true } : {}),
	}).map((key) => ({ ...key, set: input.supplied[key.key] !== undefined }));
}
