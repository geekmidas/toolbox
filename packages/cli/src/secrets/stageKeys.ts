/**
 * The keys a workspace's stage must be given — across every app, each once,
 * with who reads it and whether the stage holds it.
 *
 * The keys themselves are `requiredStageKeys`'s, the list a deploy refuses a
 * stage by. What this adds is the workspace: which constructs its apps read
 * (`appEnvKeys`, the keys each app's environment is built from) and which of
 * the keys the stage has set.
 */

import { type ConstructManifest, provideKey } from '@geekmidas/manifest';
import {
	type CredentialDeclaration,
	requiredStageKeys,
	type ServiceDeclaration,
	type StageKey,
} from '../deploy/devServices';
import { appEnvKeys } from '../reconcile/apps';
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
}

/** The keys of each kind of construct an app reads, that the stage supplies. */
function keysOf(id: string, kind: string): string[] {
	switch (kind) {
		case 'email':
			return [provideKey(id, 'url'), provideKey(id, 'from')];
		case 'objects':
		case 'file-server':
			return [provideKey(id, 'url')];
		case 'external-api':
		case 'credential':
			return [provideKey(id, 'credentials')];
		default:
			return [];
	}
}

/**
 * Every key the stage must be given for the constructs its apps read — a
 * file server's whenever its bucket is read, since its client reads both —
 * and every file server's bucket, which serves it whether or not an app
 * reads it directly.
 */
export function workspaceStageKeys(
	input: WorkspaceStageKeysInput,
): WorkspaceStageKey[] {
	const { manifest } = input;

	// What each app's environment holds.
	const reads = new Map<string, Set<string>>();
	for (const [id, declaration] of Object.entries(manifest)) {
		const { kind } = declaration;
		if (kind !== 'rest-api' && kind !== 'site' && kind !== 'mobile-app') {
			continue;
		}
		const name = appKey(id);
		const keys = appEnvKeys(manifest, name, input.runnables);
		if (keys) reads.set(name, keys);
	}

	const readers = (id: string, kind: string) => {
		const keys = keysOf(id, kind);
		return [...reads]
			.filter(([, env]) => keys.some((key) => env.has(key)))
			.map(([app]) => app)
			.sort();
	};

	const services: ServiceDeclaration[] = [];
	const credentials: CredentialDeclaration[] = [];
	const buckets = new Set<string>();
	for (const [id, declaration] of Object.entries(manifest)) {
		const { kind } = declaration;
		// A file server's client reads its bucket's URL and its own, and an
		// app's edge is to the bucket: whoever reads the bucket reads both.
		const apps =
			declaration.kind === 'file-server' && declaration.of
				? [
						...new Set([
							...readers(id, kind),
							...readers(declaration.of, 'objects'),
						]),
					].sort()
				: readers(id, kind);
		if (kind === 'external-api' || kind === 'credential') {
			if (apps.length > 0) credentials.push({ id, kind, apps });
			continue;
		}
		if (kind !== 'email' && kind !== 'objects' && kind !== 'file-server') {
			continue;
		}
		if (apps.length === 0) continue;
		const of = declaration.kind === 'file-server' ? declaration.of : undefined;
		services.push({ id, kind, ...(of ? { of } : {}), apps });
		if (of) buckets.add(of);
	}
	for (const of of buckets) {
		if (services.some((s) => s.id === of)) continue;
		if (manifest[of]?.kind !== 'objects') continue;
		services.push({ id: of, kind: 'objects', apps: readers(of, 'objects') });
	}

	return requiredStageKeys({
		local: input.local,
		services,
		credentials,
		...(input.domain ? { domain: input.domain } : {}),
	}).map((key) => ({ ...key, set: input.supplied[key.key] !== undefined }));
}
