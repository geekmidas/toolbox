import type { StorageClient } from '@geekmidas/storage';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { FileServer, type FileServerClient } from '../../file-server';
import { ObjectStorage } from '../../object-storage';

const assets = new FileServer('Assets', { open: ['public/**'] });
const archive = new ObjectStorage('Archive');

describe('a processor', () => {
	it('is handed its schema’s output as its parameters', () => {
		assets
			.process('/i/:width/*')
			.params(z.object({ width: z.enum(['64', '256']).transform(Number) }))
			.handle(async ({ params, key, object }) => {
				expectTypeOf(params).toEqualTypeOf<{ width: number }>();
				expectTypeOf(key).toBeString();
				expectTypeOf(object.bytes).returns.resolves.toEqualTypeOf<Uint8Array>();
				return { body: '', contentType: 'text/plain' };
			});
	});

	it('is handed the raw strings its pattern names, without a schema', () => {
		assets.process('/pdf/:page/:dpi/*').handle(async ({ params }) => {
			expectTypeOf(params).toEqualTypeOf<{ page: string; dpi: string }>();
			return { body: '', contentType: 'image/png' };
		});
	});

	it('reaches what it depends on as services', () => {
		assets
			.process('/copy/*')
			.dependsOn([archive])
			.handle(async ({ services }) => {
				expectTypeOf(services.archive).toEqualTypeOf<StorageClient>();
				return { body: '', contentType: 'text/plain' };
			});
	});

	it('returns a body, its type, and how long it may be kept', () => {
		assets
			.process('/x/*')
			// @ts-expect-error — a result names its content type
			.handle(async () => ({ body: '' }));
		assets
			.process('/y/*')
			// @ts-expect-error — `forever` is not a cache directive
			.handle(async () => ({ body: '', contentType: 'a/b', cache: 'forever' }));
	});

	it('is only built on a pattern that ends in the key', () => {
		// @ts-expect-error — the last segment is the key, `*`
		assets.process('/i/:width');
	});
});

describe('a processed URL', () => {
	const thumbnails = assets
		.process('/i/:width/*')
		.params(z.object({ width: z.enum(['64', '256']).transform(Number) }))
		.handle(async () => ({ body: '', contentType: 'image/webp' }));
	const client = {} as FileServerClient<'public/**'>;

	it('takes the values the schema accepts — its input', () => {
		client.processedUrl(thumbnails, { width: '256' }, 'public/a.png');
		// @ts-expect-error — not a width the schema accepts
		client.processedUrl(thumbnails, { width: '4097' }, 'public/a.png');
		// @ts-expect-error — the width is missing
		client.processedUrl(thumbnails, {}, 'public/a.png');
	});
});
