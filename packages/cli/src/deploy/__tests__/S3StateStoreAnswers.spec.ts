/**
 * The S3 state store against the answers S3 can give beyond the conformance
 * suite: a conflict or a refusal on each write, a server that omits the
 * ETag, a lock that is not JSON or not this run's, a v1 backup another run
 * already kept — and where `create` finds its endpoint, region and
 * credentials.
 *
 * Against the AWS emulator; the answers it cannot give (a 403 on an object,
 * a 409, a response without an ETag) through MSW in front of it.
 *
 * Requires the emulator: docker compose up -d localstack
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	CreateBucketCommand,
	GetObjectCommand,
	HeadBucketCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { bypass, HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { projectBucket } from '../../providers/projectBucket';
import { S3StateStore } from '../S3StateStore';
import { StateLocked, StateVersionConflict } from '../StateStore';
import { busyState } from './__helpers__/busyStage';
import { dokployState } from './__helpers__/stateStoreConformance';

const REGION = 'us-east-1';
const STAGE = 'production';
const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
const s3 = new S3Client({
	region: REGION,
	endpoint: LOCALSTACK_URL,
	forcePathStyle: true,
	credentials,
});

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
	server.resetHandlers();
	vi.unstubAllEnvs();
});
afterAll(() => server.close());

let bucket: string;
let workspace: string;

beforeEach(async () => {
	bucket = `state-answers-${randomUUID().slice(0, 8)}`;
	workspace = `ws-${randomUUID().slice(0, 8)}`;
	await s3.send(new CreateBucketCommand({ Bucket: bucket }));
});

const open = (prefix?: string) =>
	new S3StateStore(
		workspace,
		bucket,
		new S3Client({
			region: REGION,
			endpoint: LOCALSTACK_URL,
			forcePathStyle: true,
			credentials,
		}),
		prefix,
	);
const url = (leaf: string) =>
	`${LOCALSTACK_URL}/${bucket}/gkm/${workspace}/${STAGE}/${leaf}`;
const s3Error = (code: string, status: number) =>
	HttpResponse.xml(
		`<Error><Code>${code}</Code><Message>${code}</Message></Error>`,
		{ status },
	);
const put = (leaf: string, Body: string) =>
	s3.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: `gkm/${workspace}/${STAGE}/${leaf}`,
			Body,
		}),
	);
const exists = async (leaf: string) =>
	s3
		.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: `gkm/${workspace}/${STAGE}/${leaf}`,
			}),
		)
		.then(
			() => true,
			() => false,
		);

describe('S3StateStore: what S3 answers', { timeout: 60_000 }, () => {
	it('keys a store with no prefix at the workspace', async () => {
		const store = open('');
		await store.write(STAGE, busyState(STAGE), { expectedVersion: null });

		const object = await s3.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: `${workspace}/${STAGE}/state.json`,
			}),
		);
		expect(object.ETag).toBeDefined();
	});

	it('refuses a write S3 answers with a conflict as a version conflict', async () => {
		const store = open();
		const version = await store.write(STAGE, busyState(STAGE), {
			expectedVersion: null,
		});
		server.use(
			http.put(url('state.json'), () =>
				s3Error('ConditionalRequestConflict', 409),
			),
		);

		const refused = await store
			.write(STAGE, busyState(STAGE), { expectedVersion: version })
			.catch((e: unknown) => e);

		expect(refused).toBeInstanceOf(StateVersionConflict);
		expect(refused).toMatchObject({ actualVersion: version });
	});

	it('passes any other failed write through', async () => {
		server.use(http.put(url('state.json'), () => s3Error('AccessDenied', 403)));

		await expect(
			open().write(STAGE, busyState(STAGE), { expectedVersion: null }),
		).rejects.toMatchObject({ name: 'AccessDenied' });
	});

	it('reads the version back when S3 answers a write without an ETag', async () => {
		server.use(
			http.put(url('state.json'), async ({ request }) => {
				const response = await fetch(bypass(request));
				const headers = new Headers(response.headers);
				headers.delete('etag');
				return new HttpResponse(null, { status: response.status, headers });
			}),
		);
		const store = open();

		const version = await store.write(STAGE, busyState(STAGE), {
			expectedVersion: null,
		});

		expect(version).toBe((await store.read(STAGE))?.version);
	});

	it('reports no current version for a conflict on a stage with no state', async () => {
		server.use(
			http.put(url('state.json'), () => s3Error('PreconditionFailed', 412)),
		);

		const refused = await open()
			.write(STAGE, busyState(STAGE), { expectedVersion: null })
			.catch((e: unknown) => e);

		expect(refused).toBeInstanceOf(StateVersionConflict);
		expect(refused).toMatchObject({ actualVersion: null });
	});

	it('reads a state served without an ETag at an empty version', async () => {
		await open().write(STAGE, busyState(STAGE), { expectedVersion: null });
		server.use(
			http.get(url('state.json'), async ({ request }) => {
				const response = await fetch(bypass(request));
				const headers = new Headers(response.headers);
				headers.delete('etag');
				return new HttpResponse(await response.arrayBuffer(), {
					status: response.status,
					headers,
				});
			}),
		);

		const read = await open().read(STAGE);

		expect(read?.state).toEqual(busyState(STAGE));
		expect(read?.version).toBe('');
	});

	it('passes a refused read through, rather than reading no state', async () => {
		await open().write(STAGE, busyState(STAGE), { expectedVersion: null });
		server.use(http.get(url('state.json'), () => s3Error('AccessDenied', 403)));

		await expect(open().read(STAGE)).rejects.toMatchObject({
			name: 'AccessDenied',
		});
	});

	describe('a v1 state', () => {
		const seedV1 = () =>
			put('state.json', JSON.stringify(dokployState(STAGE), null, 2));

		it('migrates when another run kept the backup first', async () => {
			await seedV1();
			await put('state.v1.json', 'the first backup');

			expect((await open().read(STAGE))?.state).toEqual(dokployState(STAGE));
			const backup = await s3.send(
				new GetObjectCommand({
					Bucket: bucket,
					Key: `gkm/${workspace}/${STAGE}/state.v1.json`,
				}),
			);
			expect(await backup.Body?.transformToString()).toBe('the first backup');
		});

		it('passes a refused backup through, and migrates nothing', async () => {
			await seedV1();
			server.use(
				http.put(url('state.v1.json'), () => s3Error('AccessDenied', 403)),
			);

			await expect(open().read(STAGE)).rejects.toMatchObject({
				name: 'AccessDenied',
			});
		});
	});

	describe('the lock', () => {
		it('passes a refused lock through, rather than calling it held', async () => {
			server.use(
				http.put(url('lock.json'), () => s3Error('AccessDenied', 403)),
			);

			const refused = await open()
				.lock(STAGE)
				.catch((e: unknown) => e);

			expect(refused).not.toBeInstanceOf(StateLocked);
			expect(refused).toMatchObject({ name: 'AccessDenied' });
		});

		it('reads a lock that is not JSON as held by no one, and force-unlocks it', async () => {
			await put('lock.json', 'not json');
			const store = open();

			const locked = await store.lock(STAGE).catch((e: unknown) => e);
			expect(locked).toBeInstanceOf(StateLocked);
			expect((locked as StateLocked).holder).toBeNull();

			expect(await store.forceUnlock(STAGE)).toBeNull();
			expect(await exists('lock.json')).toBe(false);
		});

		it('leaves a lock another run took, or one it cannot read, on release', async () => {
			const store = open();
			const lock = await store.lock(STAGE);
			await put('lock.json', JSON.stringify({ ...lock.holder, id: 'theirs' }));
			await lock.release();
			expect(await exists('lock.json')).toBe(true);

			await store.forceUnlock(STAGE);
			const second = await store.lock(STAGE);
			await put('lock.json', 'not json');
			await second.release();
			expect(await exists('lock.json')).toBe(true);
		});

		it('releases quietly when the lock is already gone', async () => {
			const store = open();
			const lock = await store.lock(STAGE);
			await store.forceUnlock(STAGE);

			await expect(lock.release()).resolves.toBeUndefined();
		});

		it('keeps a lock replaced as it was deleted, and passes other failures through', async () => {
			const store = open();
			const lock = await store.lock(STAGE);
			server.use(
				http.delete(url('lock.json'), () => s3Error('PreconditionFailed', 412)),
			);
			await lock.release();
			expect(await exists('lock.json')).toBe(true);

			server.use(
				http.delete(url('lock.json'), () => s3Error('AccessDenied', 403)),
			);
			await expect(store.forceUnlock(STAGE)).rejects.toMatchObject({
				name: 'AccessDenied',
			});
		});
	});
});

describe('S3StateStore.create', { timeout: 60_000 }, () => {
	it('names the project bucket before it knows the account', () => {
		expect(
			S3StateStore.create({ workspaceName: 'shop', region: REGION }).bucket,
		).toBe('gkm-shop-<account id>');
		expect(
			S3StateStore.create({
				workspaceName: 'shop',
				namespace: 'acme',
				region: REGION,
			}).bucket,
		).toBe('gkm-acme-shop-<account id>');
	});

	it('reaches the emulator through the S3 endpoint variable, in the default region', async () => {
		vi.stubEnv('AWS_ENDPOINT_URL_S3', LOCALSTACK_URL);
		vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
		vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
		vi.stubEnv('AWS_REGION', undefined);
		const workspaceName = `create-${randomUUID().slice(0, 8)}`;
		const store = S3StateStore.create({ workspaceName });

		await (await store.lock(STAGE)).release();

		const Bucket = projectBucket(
			{ name: workspaceName },
			{ accountId: '000000000000' },
		);
		expect(store.bucket).toBe(Bucket);
		await expect(
			s3.send(new HeadBucketCommand({ Bucket })),
		).resolves.toBeDefined();
	});

	it('resolves a named profile from the profile', async () => {
		const home = mkdtempSync(join(tmpdir(), 'gkm-state-profile-'));
		writeFileSync(
			join(home, 'credentials'),
			'[acme-prod]\naws_access_key_id = LSIAPRODKEY\naws_secret_access_key = prod\n',
		);
		writeFileSync(join(home, 'config'), '');
		vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', join(home, 'credentials'));
		vi.stubEnv('AWS_CONFIG_FILE', join(home, 'config'));
		vi.stubEnv('AWS_ACCESS_KEY_ID', 'LSIASTAGINGKEY');

		try {
			const store = S3StateStore.create({
				workspaceName: 'shop',
				bucket: 'acme-state',
				region: REGION,
				profile: 'acme-prod',
			});
			const client = (store as unknown as { client: S3Client }).client;

			expect((await client.config.credentials()).accessKeyId).toBe(
				'LSIAPRODKEY',
			);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
