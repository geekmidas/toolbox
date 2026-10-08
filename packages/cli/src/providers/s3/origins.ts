/**
 * Which browser origins may call a bucket: the stage's sites that depend on
 * an API using it.
 *
 * The same reading of the graph an API's own CORS origins are — its callers —
 * taken one step further: a site that calls an API which hands it a presigned
 * upload URL is a site whose browser PUTs to the bucket. A site that reads the
 * bucket (or a file server over it) itself is one too. Nothing is written
 * down: add a site that calls the API and the next provision run allows it.
 */

import {
	type ConstructManifest,
	dependentsOf,
	provideKey,
} from '@geekmidas/manifest';
import { appEnvKeys } from '../../reconcile/apps.js';
import {
	isMainFrontendApp,
	NoDomainForStage,
	resolveHost,
} from '../../target/dokploy/domain.js';
import { appKey } from '../../workspace/derive.js';
import type { NormalizedWorkspace } from '../../workspace/types.js';

export interface BucketOriginsInput {
	workspace: Pick<NormalizedWorkspace, 'apps' | 'deploy' | 'domains'>;
	manifest: ConstructManifest;
	/** Each owner's runnables' edges, from discovery. */
	runnables?: Readonly<Record<string, readonly string[]>>;
	stage: string;
	/** The `objects` construct's id. */
	bucket: string;
}

export interface BucketOrigins {
	/** `https://<host>` for each site, sorted. */
	origins: string[];
	/** Sites with no address on the stage — no domain for it. */
	unresolved: string[];
}

/** The keys a reader of this bucket holds: its URL, and each server's over it. */
export function bucketKeys(manifest: ConstructManifest, bucket: string) {
	return [
		provideKey(bucket, 'url'),
		...Object.entries(manifest)
			.filter(([, d]) => d.kind === 'file-server' && d.of === bucket)
			.map(([id]) => provideKey(id, 'url')),
	];
}

export function bucketOrigins(input: BucketOriginsInput): BucketOrigins {
	const { manifest, workspace, stage } = input;
	const keys = bucketKeys(manifest, input.bucket);

	const readers = Object.entries(manifest)
		.filter(([, d]) => d.kind === 'rest-api' || d.kind === 'site')
		.filter(([id]) => {
			const env = appEnvKeys(manifest, appKey(id), input.runnables);
			return env !== undefined && keys.some((key) => env.has(key));
		});

	const sites = new Set<string>();
	for (const [id, declaration] of readers) {
		if (declaration.kind === 'site') {
			sites.add(id);
			continue;
		}
		for (const caller of dependentsOf(manifest, id)) {
			if (manifest[caller]?.kind === 'site') sites.add(caller);
		}
	}

	const origins = new Set<string>();
	const unresolved: string[] = [];
	for (const id of [...sites].sort()) {
		const name = appKey(id);
		const app = workspace.apps[name];
		if (!app) {
			unresolved.push(name);
			continue;
		}
		try {
			const host = resolveHost(
				name,
				app,
				stage,
				workspace.domains,
				isMainFrontendApp(name, app, workspace.apps),
			);
			origins.add(`https://${host}`);
		} catch (error) {
			if (!(error instanceof NoDomainForStage)) throw error;
			unresolved.push(name);
		}
	}

	return { origins: [...origins].sort(), unresolved };
}
