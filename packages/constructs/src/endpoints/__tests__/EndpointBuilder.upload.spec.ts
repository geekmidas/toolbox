import {
	AmazonCannedAccessControlList,
	AmazonStorageClient,
} from '@geekmidas/storage/aws';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MINIO_URL } from '../../../../testkit/test/ports';
import { ObjectStorage } from '../../object-storage';
import { RestApi } from '../../rest-api';
import { Endpoint } from '../Endpoint';
import { TestEndpointAdaptor } from '../TestEndpointAdaptor';
import {
	UploadAcceptInvalid,
	UploadContentTypeRefused,
	UploadContentTypeUnresolved,
	UploadExpiryInvalid,
	UploadMaxSizeInvalid,
	type UploadPost,
} from '../upload';

const api = new RestApi('Test', { path: '.', defaultAuthorizer: 'none' });
const uploads = new ObjectStorage('Uploads');

/** The repo compose stack's MinIO, which the project's `globalSetup` starts. */
const storage = AmazonStorageClient.create({
	bucket: 'geekmidas',
	region: 'us-east-1',
	accessKeyId: 'geekmidas',
	secretAccessKey: 'geekmidas',
	endpoint: MINIO_URL,
	acl: AmazonCannedAccessControlList.Private,
	forcePathStyle: true,
});

/** Every request is someone's: the session a branch reads. */
const signedIn = api.session(async () => ({ userId: crypto.randomUUID() }));

/** Post `body` through the form, the file last, as a browser would. */
function post(
	form: UploadPost,
	body: string,
	type: string,
	extra: Record<string, string> = {},
) {
	const data = new FormData();
	for (const [key, value] of Object.entries({ ...form.fields, ...extra })) {
		data.append(key, value);
	}
	data.append('file', new Blob([body], { type }));
	return fetch(form.url, { method: 'POST', body: data });
}

/** Call the endpoint as a client would, with the real bucket behind it. */
function request<T = UploadPost>(endpoint: unknown, body?: unknown) {
	return new TestEndpointAdaptor(endpoint as never).request({
		services: { uploads: storage },
		headers: { host: 'example.com', 'content-type': 'application/json' },
		...(body ? { body } : {}),
	} as never) as Promise<T>;
}

describe('.upload(bucket, …)', () => {
	it('hands back a form that lands the file at the key the session and body chose', async () => {
		let userId = '';
		const avatar = signedIn
			.post('/me/avatar')
			.body(z.object({ name: z.string() }))
			.upload(uploads, {
				key: ({ session, body }) => {
					userId = session.userId;
					return `avatars/${session.userId}/${body.name}.png`;
				},
				maxSize: 1024,
				accept: ['image/png'],
			})
			.handle(async ({ upload }) => upload);

		const form = await request(avatar, { name: 'me' });

		expect(form.key).toBe(`avatars/${userId}/me.png`);
		expect(form.fields['Content-Type']).toBe('image/png');
		const response = await post(form, 'png bytes', 'image/png');
		expect(response.status).toBeLessThan(300);
		const stored = await fetch(
			await storage.getDownloadURL({ path: form.key }),
		);
		expect(await stored.text()).toBe('png bytes');
	});

	it('is refused by the storage for a file over maxSize', async () => {
		const endpoint = signedIn
			.post('/small')
			.upload(uploads, {
				key: ({ session }) => `small/${session.userId}`,
				maxSize: 8,
			})
			.handle(async ({ upload }) => upload);

		const form = await request(endpoint);
		const response = await post(
			form,
			'far more than eight bytes',
			'text/plain',
		);

		expect(response.status).toBe(400);
		expect(await response.text()).toContain('EntityTooLarge');
	});

	it('is refused by the storage for a type it does not accept', async () => {
		const endpoint = signedIn
			.post('/images')
			.upload(uploads, {
				key: ({ session }) => `images/${session.userId}`,
				maxSize: 1024,
				accept: ['image/*'],
			})
			.handle(async ({ upload }) => upload);

		const form = await request(endpoint);

		const image = await post(form, 'a jpeg', 'image/jpeg', {
			'Content-Type': 'image/jpeg',
		});
		expect(image.status).toBeLessThan(300);
		const text = await post(form, 'text', 'text/plain', {
			'Content-Type': 'text/plain',
		});
		expect(text.status).toBe(403);
	});

	it('fixes the type the body names, from those it accepts', async () => {
		const endpoint = signedIn
			.post('/documents')
			.body(z.object({ contentType: z.string() }))
			.upload(uploads, {
				key: ({ session }) => `documents/${session.userId}`,
				maxSize: 1024,
				accept: ['application/pdf', 'image/png'],
				contentType: ({ body }) => body.contentType,
			})
			.handle(async ({ upload }) => upload);

		const form = await request(endpoint, { contentType: 'application/pdf' });
		expect(form.fields['Content-Type']).toBe('application/pdf');

		const refused = request(endpoint, { contentType: 'text/html' });
		await expect(refused).rejects.toBeInstanceOf(UploadContentTypeRefused);
		await expect(refused).rejects.toMatchObject({ statusCode: 415 });
	});

	it('lets the handler say more than the form, under its own output', async () => {
		const endpoint = signedIn
			.post('/with-id')
			.output(
				z.object({ id: z.string(), upload: z.object({ key: z.string() }) }),
			)
			.upload(uploads, { key: () => 'with-id/file', maxSize: 1024 })
			.handle(async ({ upload }) => ({
				id: 'abc',
				upload: { key: upload.key },
			}));

		await expect(request(endpoint)).resolves.toEqual({
			id: 'abc',
			upload: { key: 'with-id/file' },
		});
	});

	it('depends on the bucket, as .dependsOn([bucket]) does', () => {
		const endpoint = signedIn
			.post('/files')
			.upload(uploads, { key: () => 'files/x', maxSize: 1 })
			.handle(async ({ upload, services }) => {
				// The bucket's client is the handler's too.
				await services.uploads.delete('files/stale');
				return upload;
			});

		expect(endpoint.services.map((s) => s.serviceName)).toContain('uploads');
		expect(endpoint.constructs).toContain('Uploads');
	});

	it('documents the form as the response, when the endpoint declares none', async () => {
		const endpoint = signedIn
			.post('/documented')
			.upload(uploads, { key: () => 'documented', maxSize: 1 })
			.handle(async ({ upload }) => upload);

		const doc = await Endpoint.buildOpenApiSchema([endpoint]);
		const schema = (doc.paths['/documented'] as any).post.responses['200']
			.content['application/json'].schema;

		expect(schema).toEqual({
			type: 'object',
			properties: {
				url: { type: 'string', format: 'uri' },
				fields: { type: 'object', additionalProperties: { type: 'string' } },
				key: { type: 'string' },
				expiresAt: { type: 'string', format: 'date-time' },
			},
			required: ['url', 'fields', 'key', 'expiresAt'],
			additionalProperties: false,
		});
	});

	describe('refuses options it could never honour, when it is built', () => {
		const build = (options: Record<string, unknown>) => () =>
			api.post('/x').upload(uploads, {
				key: () => 'x',
				maxSize: 1,
				...options,
			} as never);

		it.each([0, -1, 1.5, Number.NaN])('maxSize %s', (maxSize) => {
			expect(build({ maxSize })).toThrow(UploadMaxSizeInvalid);
		});

		it.each([0, 1.5, 7 * 24 * 60 * 60 + 1])('expiresIn %s', (expiresIn) => {
			expect(build({ expiresIn })).toThrow(UploadExpiryInvalid);
		});

		it('an accepted type that is not a media type', () => {
			expect(build({ accept: ['png'] })).toThrow(UploadAcceptInvalid);
		});

		it('several accepted types, and nothing saying which', () => {
			expect(build({ accept: ['image/png', 'image/jpeg'] })).toThrow(
				UploadContentTypeUnresolved,
			);
		});
	});
});
