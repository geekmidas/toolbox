import { registerStorageDriver, type StorageClient } from '@geekmidas/storage';
import type { ObjectEvent } from '@geekmidas/storage/events';
import { describe, expect } from 'vitest';
import { z } from 'zod/v4';
import { ObjectStorage } from '../../object-storage';
import { RestApi } from '../../rest-api';
import { Worker } from '../../worker';
import { BucketNotWatched, featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * A bucket's changes reach its subscribers in-process, as the storage would
 * report them: what a handler uploads through the bucket's client, and what a
 * test emits for an upload the app never sees.
 */

/** Objects in memory, by key — the storage the bucket's client writes to. */
const stored = new Map<string, string | Buffer>();
registerStorageDriver({
	scheme: 'memory:',
	create: () =>
		({
			async upload(key: string, data: string | Buffer) {
				stored.set(key, data);
			},
			async delete(key: string) {
				stored.delete(key);
			},
		}) as unknown as StorageClient,
});

const seen = { avatars: [] as ObjectEvent[], removed: [] as ObjectEvent[] };

const uploads = new ObjectStorage('Uploads');
const worker = new Worker('Jobs');

const onAvatar = worker
	.objects(uploads)
	.on(['object.created'], { prefix: 'avatars/' })
	.handle(async ({ objects }) => {
		seen.avatars.push(...objects);
	});
const onRemoved = worker
	.objects(uploads)
	.on(['object.deleted'])
	.handle(async ({ objects }) => {
		seen.removed.push(...objects);
	});

const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });

const uploadAvatar = api
	.post('/avatars')
	.body(z.object({ name: z.string() }))
	.dependsOn([uploads])
	.handle(async ({ body, services }) => {
		await services.uploads.upload(`avatars/${body.name}`, 'png!', 'image/png');
		await services.uploads.upload(
			`docs/${body.name}`,
			'pdf',
			'application/pdf',
		);
		return {};
	});

const source = (file: string, name: string) => ({ file, export: name });

const manifest: TestManifest = {
	stage: 'test',
	constructs: {
		Uploads: { kind: 'objects', source: source('constructs', 'uploads') },
	},
	endpoints: [{ surface: 'Api', source: source('endpoints', 'uploadAvatar') }],
	subscribers: ['onAvatar', 'onRemoved'].map((name) => ({
		source: source('subscribers', name),
	})),
	env: {
		API_URL: 'http://api.objects.test',
		UPLOADS_URL: 'memory://acme-uploads',
	},
};

const it = featureTest({
	manifest,
	modules: {
		constructs: { uploads },
		endpoints: { uploadAvatar },
		subscribers: { onAvatar, onRemoved },
	},
});

describe('featureTest delivery to a bucket’s subscribers', () => {
	it('reports what a handler uploads, to the subscribers watching that key', async ({
		browser,
	}) => {
		seen.avatars.length = 0;

		await browser.fetch('http://api.objects.test/avatars', {
			method: 'POST',
			body: JSON.stringify({ name: 'me.png' }),
			headers: { 'content-type': 'application/json' },
		});

		expect(stored.get('avatars/me.png')).toBe('png!');
		// The upload under `docs/` is outside the prefix the subscriber watches.
		expect(seen.avatars).toEqual([
			{ bucket: 'acme-uploads', key: 'avatars/me.png', size: 4 },
		]);
	});

	it('reports what the test deletes through the bucket’s client, at once', async ({
		services,
	}) => {
		seen.removed.length = 0;
		const client = (await services.get('uploads')) as StorageClient;

		await client.delete('avatars/old.png');

		expect(seen.removed).toEqual([
			{ bucket: 'acme-uploads', key: 'avatars/old.png' },
		]);
	});

	it('delivers what a test emits for an upload the app never sees', async ({
		objects,
	}) => {
		seen.avatars.length = 0;

		await objects(uploads).emit({
			type: 'object.created',
			key: 'avatars/direct.png',
			size: 9,
		});

		expect(seen.avatars).toEqual([
			{ bucket: 'acme-uploads', key: 'avatars/direct.png', size: 9 },
		]);
	});

	it('refuses to emit on a bucket nothing watches', async ({ objects }) => {
		await expect(
			objects(new ObjectStorage('Elsewhere')).emit({
				type: 'object.created',
				key: 'a',
			}),
		).rejects.toBeInstanceOf(BucketNotWatched);
	});
});
