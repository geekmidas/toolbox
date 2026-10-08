import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import type { NormalizedWorkspace } from '../../workspace/types';
import { bucketOrigins } from '../s3/origins';

/**
 * A bucket's CORS origins, read off the compose fixture's graph: the site
 * `web` calls the API, and the API writes to the bucket — so `web`'s origin
 * may PUT to it. A second bucket nothing reads has no origins at all.
 */

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let runnables: Record<string, string[]>;

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-provider-origins-'));
	writeComposeApp(dir, {
		deployed: ['production', 'preview'],
		domains: { production: 'shop.example.com' },
	});
	writeFileSync(
		join(dir, 'constructs', 'storage.ts'),
		`import { FileServer } from '@geekmidas/constructs/file-server';
import { ObjectStorage } from '@geekmidas/constructs/object-storage';

export const uploads = new FileServer('Uploads', { open: ['brand/**'] });
export const archive = new ObjectStorage('Archive');
`,
	);
	writeFileSync(
		join(dir, 'apps', 'api', 'endpoints', 'upload.ts'),
		`import { api } from '../../../constructs/api.js';
import { uploads } from '../../../constructs/storage.js';

export const upload = api
	.post('/upload')
	.dependsOn([uploads])
	.handle(async () => ({ ok: true }));
`,
	);
	({ workspace, manifest, runnables } = await loadComposeApp(dir));
}, 120_000);

afterAll(async () => {
	await cleanupDir(dir);
});

describe("a bucket's CORS origins", () => {
	it('are the sites that call an API using the bucket', () => {
		expect(
			bucketOrigins({
				workspace,
				manifest,
				runnables,
				stage: 'production',
				bucket: 'Uploads',
			}),
		).toEqual({ origins: ['https://shop.example.com'], unresolved: [] });
	});

	it('are none for a bucket no API uses', () => {
		expect(
			bucketOrigins({
				workspace,
				manifest,
				runnables,
				stage: 'production',
				bucket: 'Archive',
			}),
		).toEqual({ origins: [], unresolved: [] });
	});

	it('name a site with no address on the stage rather than guess one', () => {
		expect(
			bucketOrigins({
				workspace,
				manifest,
				runnables,
				stage: 'preview',
				bucket: 'Uploads',
			}),
		).toEqual({ origins: [], unresolved: ['web'] });
	});
});
