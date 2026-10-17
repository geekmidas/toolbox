import type { StorageClient } from '@geekmidas/storage';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { ObjectStorage } from '../../object-storage';
import { RestApi } from '../../rest-api';
import type { EndpointOutput } from '../Endpoint';
import type { UploadPost } from '../upload';

const api = new RestApi('Test', { path: '.', defaultAuthorizer: 'none' });
const uploads = new ObjectStorage('Uploads');
const signedIn = api.session(async () => ({ userId: 'u1' }));

describe('.upload(bucket, …)', () => {
	it('resolves the key from what the handler would be given', () => {
		signedIn
			.post('/me/avatar')
			.body(z.object({ name: z.string() }))
			.upload(uploads, {
				key: ({ session, body, services }) => {
					expectTypeOf(session).toEqualTypeOf<{ userId: string }>();
					expectTypeOf(body).toEqualTypeOf<{ name: string }>();
					expectTypeOf(services.uploads).toEqualTypeOf<StorageClient>();
					return `avatars/${session.userId}/${body.name}`;
				},
				maxSize: 1024,
			})
			.handle(async () => ({
				url: '',
				fields: {},
				key: '',
				expiresAt: '',
			}));
	});

	it('hands the handler the form, and makes it the output', () => {
		const endpoint = api
			.post('/files')
			.upload(uploads, { key: () => 'x', maxSize: 1 })
			.handle(async ({ upload, services }) => {
				expectTypeOf(upload).toEqualTypeOf<UploadPost>();
				expectTypeOf(services.uploads).toEqualTypeOf<StorageClient>();
				return upload;
			});

		expectTypeOf<EndpointOutput<typeof endpoint>>().toEqualTypeOf<UploadPost>();
	});

	it('keeps an output the endpoint declared first', () => {
		api
			.post('/files')
			.output(z.object({ id: z.string() }))
			.upload(uploads, { key: () => 'x', maxSize: 1 })
			// @ts-expect-error the declared output has no room for the form
			.handle(async ({ upload }) => upload);
	});

	it('takes a bucket, not any construct', () => {
		api.post('/files').upload(
			// @ts-expect-error a surface is not a bucket
			api,
			{ key: () => 'x', maxSize: 1 },
		);
	});
});
