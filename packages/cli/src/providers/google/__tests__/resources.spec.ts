import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import {
	errorDetail,
	finished,
	GoogleApiError,
	GoogleOperationTimedOut,
	googleClient,
} from '../client';
import {
	CLOUD_RESOURCE_MANAGER,
	createKey,
	deleteKey,
	enableService,
	ensureProject,
	ensureServiceAccount,
	GoogleIdInvalid,
	GoogleProjectUnavailable,
	IAM,
	keyId,
	listKeys,
	SERVICE_USAGE,
} from '../resources';

/**
 * The Google REST calls every Google provider starts from, against Resource
 * Manager, Service Usage and IAM stood in for by MSW in their own shapes.
 */

const server = setupServer();
let seen: { method: string; url: string; headers: Headers; body: string }[];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
	seen = [];
	server.events.on('request:start', async ({ request }) => {
		seen.push({
			method: request.method,
			url: request.url,
			headers: request.headers,
			body: await request.clone().text(),
		});
	});
});
afterEach(() => {
	server.resetHandlers();
	server.events.removeAllListeners();
});

const client = googleClient('ya29.token', 'acme-maps');

describe('a Google client', () => {
	it('sends the token, the quota project and a JSON body', async () => {
		server.use(
			http.post('https://example.googleapis.com/v1/things', () =>
				HttpResponse.json({ name: 'things/1' }),
			),
		);

		const answer = await client.request(
			'POST',
			'https://example.googleapis.com/v1/things',
			{ a: 1 },
		);

		expect({
			answer,
			authorization: seen[0]!.headers.get('authorization'),
			quota: seen[0]!.headers.get('x-goog-user-project'),
			type: seen[0]!.headers.get('content-type'),
			body: seen[0]!.body,
		}).toEqual({
			answer: { name: 'things/1' },
			authorization: 'Bearer ya29.token',
			quota: 'acme-maps',
			type: 'application/json',
			body: '{"a":1}',
		});
	});

	it('names no quota project when it has none, and reads an empty answer as {}', async () => {
		server.use(
			http.delete(
				'https://example.googleapis.com/v1/things/1',
				() => new HttpResponse(null, { status: 204 }),
			),
		);

		const answer = await googleClient('ya29.token').request(
			'DELETE',
			'https://example.googleapis.com/v1/things/1',
		);

		expect({
			answer,
			quota: seen[0]!.headers.get('x-goog-user-project'),
			type: seen[0]!.headers.get('content-type'),
		}).toEqual({ answer: {}, quota: null, type: null });
	});

	it('uploads raw bytes with their own content type', async () => {
		server.use(
			http.post('https://example.googleapis.com/upload', () =>
				HttpResponse.json({ ok: true }),
			),
		);

		await client.request(
			'POST',
			'https://example.googleapis.com/upload',
			undefined,
			{
				raw: {
					contentType: 'image/png',
					data: new TextEncoder().encode('png'),
				},
			},
		);

		expect({
			type: seen[0]!.headers.get('content-type'),
			body: seen[0]!.body,
		}).toEqual({ type: 'image/png', body: 'png' });
	});

	it('throws what Google said when it refuses', async () => {
		server.use(
			http.get('https://example.googleapis.com/v1/secret', () =>
				HttpResponse.json(
					{
						error: {
							code: 403,
							message: 'The caller does not have permission',
						},
					},
					{ status: 403 },
				),
			),
		);

		await expect(
			client.request('GET', 'https://example.googleapis.com/v1/secret'),
		).rejects.toMatchObject({
			name: 'GoogleApiError',
			method: 'GET',
			status: 403,
			detail: 'The caller does not have permission',
		});
	});
});

describe("Google's error detail", () => {
	it.for([
		['{"error":{"message":"denied"}}', 'denied'],
		['{"error":"invalid_grant","error_description":"expired"}', 'expired'],
		['{"error":"invalid_grant"}', 'invalid_grant'],
		['{"error":{"code":500}}', '{"error":{"code":500}}'],
		['<html>Bad Gateway</html>', '<html>Bad Gateway</html>'],
	] as const)('%s → %s', ([text, detail]) => {
		expect(errorDetail(text)).toBe(detail);
	});
});

describe('a long-running operation', () => {
	const BASE = 'https://example.googleapis.com/v1';

	it('is polled until it is done', async () => {
		let polls = 0;
		server.use(
			http.get(`${BASE}/operations/op-1`, () => {
				polls++;
				return HttpResponse.json({ name: 'operations/op-1', done: polls > 1 });
			}),
		);

		await finished(
			client,
			BASE,
			{ name: 'operations/op-1' },
			{ intervalMs: 0 },
		);

		expect(polls).toBe(2);
	});

	it('throws the error a finished operation carries', async () => {
		await expect(
			finished(client, BASE, {
				name: 'operations/op-2',
				done: true,
				error: { message: 'Billing must be enabled' },
			}),
		).rejects.toMatchObject({
			name: 'GoogleApiError',
			detail: 'Billing must be enabled',
		});
	});

	it('says the operation failed when its error has no message', async () => {
		await expect(
			finished(client, BASE, {
				name: 'operations/op-3',
				done: true,
				error: {},
			}),
		).rejects.toMatchObject({ detail: 'the operation failed' });
	});

	it('gives up after its attempts, naming the operation', async () => {
		server.use(
			http.get(`${BASE}/operations/slow`, () =>
				HttpResponse.json({ name: 'operations/slow', done: false }),
			),
		);

		const slow = finished(
			client,
			BASE,
			{ name: 'operations/slow' },
			{ intervalMs: 0, attempts: 2 },
		);

		await expect(slow).rejects.toBeInstanceOf(GoogleOperationTimedOut);
		await expect(slow).rejects.toMatchObject({ operation: 'operations/slow' });
	});

	it('names an unnamed operation that never finishes', async () => {
		await expect(
			finished(client, BASE, {}, { intervalMs: 0, attempts: 0 }),
		).rejects.toMatchObject({ operation: '(unnamed)' });
	});
});

describe('a project', () => {
	it('is reused when it is there', async () => {
		server.use(
			http.get(`${CLOUD_RESOURCE_MANAGER}/projects/acme-maps`, () =>
				HttpResponse.json({ projectId: 'acme-maps' }),
			),
		);

		expect(await ensureProject(client, 'acme-maps', 'Acme maps')).toBe(false);
	});

	it.for([
		403, 404,
	])('is created when Google answers %i, its name cut to 30', async (status) => {
		let created: unknown;
		server.use(
			http.get(
				`${CLOUD_RESOURCE_MANAGER}/projects/acme-maps`,
				() => new HttpResponse('{}', { status }),
			),
			http.post(`${CLOUD_RESOURCE_MANAGER}/projects`, async ({ request }) => {
				created = await request.json();
				return HttpResponse.json({ name: 'operations/cp.1', done: true });
			}),
		);

		const made = await ensureProject(client, 'acme-maps', 'A'.repeat(40));

		expect({ made, created }).toEqual({
			made: true,
			created: { projectId: 'acme-maps', displayName: 'A'.repeat(30) },
		});
	});

	it('says the id is taken when Google will not create it', async () => {
		server.use(
			http.get(
				`${CLOUD_RESOURCE_MANAGER}/projects/acme-maps`,
				() => new HttpResponse('{}', { status: 404 }),
			),
			http.post(`${CLOUD_RESOURCE_MANAGER}/projects`, () =>
				HttpResponse.json(
					{ error: { message: 'Requested entity already exists' } },
					{ status: 409 },
				),
			),
		);

		const refused = ensureProject(client, 'acme-maps', 'Acme');

		await expect(refused).rejects.toBeInstanceOf(GoogleProjectUnavailable);
		await expect(refused).rejects.toMatchObject({
			detail: 'Requested entity already exists',
		});
	});

	it('passes on any other refusal to look', async () => {
		server.use(
			http.get(
				`${CLOUD_RESOURCE_MANAGER}/projects/acme-maps`,
				() => new HttpResponse('{}', { status: 500 }),
			),
		);

		await expect(
			ensureProject(client, 'acme-maps', 'Acme'),
		).rejects.toMatchObject({ name: 'GoogleApiError', status: 500 });
	});

	it('refuses an id Google would not accept, before calling it', async () => {
		await expect(
			ensureProject(client, 'Acme_Maps', 'Acme'),
		).rejects.toBeInstanceOf(GoogleIdInvalid);
		expect(seen).toEqual([]);
	});
});

describe('an API', () => {
	it('is turned on, and its operation waited for', async () => {
		server.use(
			http.post(
				`${SERVICE_USAGE}/projects/acme-maps/services/apikeys.googleapis.com:enable`,
				() => HttpResponse.json({ name: 'operations/acf.1', done: true }),
			),
		);

		await enableService(client, 'acme-maps', 'apikeys.googleapis.com');

		expect(seen.map(({ method, url }) => `${method} ${url}`)).toEqual([
			`POST ${SERVICE_USAGE}/projects/acme-maps/services/apikeys.googleapis.com:enable`,
		]);
	});
});

describe('a service account and its keys', () => {
	const EMAIL = 'gkm-play@acme-maps.iam.gserviceaccount.com';

	it('is reused when it is there', async () => {
		server.use(
			http.get(`${IAM}/projects/acme-maps/serviceAccounts/${EMAIL}`, () =>
				HttpResponse.json({ email: EMAIL }),
			),
		);

		expect(
			await ensureServiceAccount(client, 'acme-maps', 'gkm-play', 'Play'),
		).toBe(EMAIL);
	});

	it('is created when it is not', async () => {
		let created: unknown;
		server.use(
			http.get(
				`${IAM}/projects/acme-maps/serviceAccounts/${EMAIL}`,
				() => new HttpResponse('{}', { status: 404 }),
			),
			http.post(
				`${IAM}/projects/acme-maps/serviceAccounts`,
				async ({ request }) => {
					created = await request.json();
					return HttpResponse.json({ email: EMAIL });
				},
			),
		);

		await ensureServiceAccount(client, 'acme-maps', 'gkm-play', 'Play');

		expect(created).toEqual({
			accountId: 'gkm-play',
			serviceAccount: { displayName: 'Play' },
		});
	});

	it('passes on a refusal to look', async () => {
		server.use(
			http.get(
				`${IAM}/projects/acme-maps/serviceAccounts/${EMAIL}`,
				() => new HttpResponse('{}', { status: 403 }),
			),
		);

		await expect(
			ensureServiceAccount(client, 'acme-maps', 'gkm-play', 'Play'),
		).rejects.toBeInstanceOf(GoogleApiError);
	});

	it('creates, lists and deletes keys', async () => {
		const name = `projects/acme-maps/serviceAccounts/${EMAIL}/keys/k1`;
		server.use(
			http.post(`${IAM}/projects/acme-maps/serviceAccounts/${EMAIL}/keys`, () =>
				HttpResponse.json({
					name,
					privateKeyData: Buffer.from('{"type":"service_account"}').toString(
						'base64',
					),
				}),
			),
			http.get(`${IAM}/projects/acme-maps/serviceAccounts/${EMAIL}/keys`, () =>
				HttpResponse.json({}),
			),
			http.delete(`${IAM}/${name}`, () => HttpResponse.json({})),
		);

		const key = await createKey(client, 'acme-maps', EMAIL);
		const listed = await listKeys(client, 'acme-maps', EMAIL);
		await deleteKey(client, key);

		expect({ key, id: keyId(key), listed, last: seen.at(-1)!.method }).toEqual({
			key: { name, json: '{"type":"service_account"}' },
			id: 'k1',
			listed: [],
			last: 'DELETE',
		});
	});
});
