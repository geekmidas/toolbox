/**
 * The project bucket, as the S3 state store uses it: found by a name worked
 * out from the project and the account, created by the first write with
 * everything it should have, reused after, never created by a read, and
 * refused when another account holds the name.
 *
 * Against the AWS emulator; a HEAD answered 403 — another account's bucket,
 * which the emulator cannot show — through MSW in front of it.
 *
 * Requires the emulator: docker compose up -d localstack
 */

import { randomUUID } from 'node:crypto';
import {
	GetBucketEncryptionCommand,
	GetBucketLifecycleConfigurationCommand,
	GetBucketOwnershipControlsCommand,
	GetBucketTaggingCommand,
	GetBucketVersioningCommand,
	GetPublicAccessBlockCommand,
	HeadBucketCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { bypass, HttpResponse, http, passthrough } from 'msw';
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
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import {
	busyDocument,
	busyResources,
	busyState,
} from '../../deploy/__tests__/__helpers__/busyStage';
import { S3StateStore } from '../../deploy/S3StateStore';
import { StateLocked } from '../../deploy/StateStore';
import {
	ensureProjectBucket,
	findProjectBucket,
	NONCURRENT_VERSION_DAYS,
	ProjectBucketNotCreatable,
	ProjectBucketTaken,
	projectBucket,
	projectBucketLifecycle,
	projectBucketName,
} from '../projectBucket';

const REGION = 'eu-west-1';
const ACCOUNT = '000000000000';
const STAGE = 'production';
const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };

const s3 = new S3Client({
	region: REGION,
	endpoint: LOCALSTACK_URL,
	forcePathStyle: true,
	credentials,
});

const server = setupServer();
/** Every `CreateBucket` that reached S3: a PUT of the bucket, no query. */
let creates: string[] = [];

beforeAll(() => {
	server.listen({ onUnhandledRequest: 'bypass' });
	server.events.on('request:start', ({ request }) => {
		const url = new URL(request.url);
		if (
			request.method === 'PUT' &&
			url.search === '' &&
			/^\/[^/]+\/?$/.test(url.pathname)
		) {
			creates.push(url.pathname.replace(/\//g, ''));
		}
	});
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let project: string;
const open = () =>
	S3StateStore.create({
		workspaceName: project,
		region: REGION,
		endpoint: LOCALSTACK_URL,
		credentials,
	});
const bucketOf = () => projectBucket({ name: project }, { accountId: ACCOUNT });
const exists = () =>
	s3.send(new HeadBucketCommand({ Bucket: bucketOf() })).then(
		() => true,
		() => false,
	);

beforeEach(() => {
	// A project of its own per test: the emulator outlives the suite.
	project = `shop-${randomUUID().slice(0, 8)}`;
	creates = [];
});

describe('projectBucketName', () => {
	it('is gkm-<scope>-<account>', () => {
		expect(projectBucketName('acme-shop', '123456789012')).toBe(
			'gkm-acme-shop-123456789012',
		);
	});

	it('keeps a long scope within 63 characters, apart from a similar one', () => {
		const a = projectBucketName(`${'a'.repeat(60)}-one`, '123456789012');
		const b = projectBucketName(`${'a'.repeat(60)}-two`, '123456789012');

		expect(a.length).toBeLessThanOrEqual(63);
		expect(b.length).toBeLessThanOrEqual(63);
		expect(a).not.toBe(b);
		expect(a).toMatch(/^gkm-[a-z0-9-]+-123456789012$/);
	});

	it('is named by the namespace too, as the s3 provider names buckets', () => {
		expect(
			projectBucket(
				{ name: 'shop', deploy: { namespace: 'acme' } },
				{ accountId: '123456789012' },
			),
		).toBe('gkm-acme-shop-123456789012');
	});
});

describe('projectBucketLifecycle', () => {
	it('is the noncurrent-version rule, and any prefix expiry beside it', () => {
		expect(projectBucketLifecycle()).toHaveLength(1);
		const rules = projectBucketLifecycle([
			{
				id: 'backups-production',
				prefix: 'gkm/shop/production/backups/',
				days: 30,
			},
		]);
		expect(rules.map((r) => r.ID)).toEqual([
			'gkm-noncurrent-versions',
			'backups-production',
		]);
	});
});

describe('S3StateStore in the project bucket', { timeout: 60_000 }, () => {
	it('creates the bucket on the first lock, configured, then writes', async () => {
		const store = open();
		const lock = await store.lock(STAGE, { operation: 'deploy' });
		await store.write(STAGE, busyState(STAGE), { expectedVersion: null });
		await lock.release();

		const Bucket = bucketOf();
		expect(creates).toEqual([Bucket]);
		expect(store.bucket).toBe(Bucket);

		const versioning = await s3.send(
			new GetBucketVersioningCommand({ Bucket }),
		);
		expect(versioning.Status).toBe('Enabled');
		const encryption = await s3.send(
			new GetBucketEncryptionCommand({ Bucket }),
		);
		expect(
			encryption.ServerSideEncryptionConfiguration?.Rules?.[0]
				?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm,
		).toBe('AES256');
		const block = await s3.send(new GetPublicAccessBlockCommand({ Bucket }));
		expect(block.PublicAccessBlockConfiguration).toEqual({
			BlockPublicAcls: true,
			IgnorePublicAcls: true,
			BlockPublicPolicy: true,
			RestrictPublicBuckets: true,
		});
		const ownership = await s3.send(
			new GetBucketOwnershipControlsCommand({ Bucket }),
		);
		expect(ownership.OwnershipControls?.Rules?.[0]?.ObjectOwnership).toBe(
			'BucketOwnerEnforced',
		);
		const lifecycle = await s3.send(
			new GetBucketLifecycleConfigurationCommand({ Bucket }),
		);
		expect(
			lifecycle.Rules?.[0]?.NoncurrentVersionExpiration?.NoncurrentDays,
		).toBe(NONCURRENT_VERSION_DAYS);
		const tags = await s3.send(new GetBucketTaggingCommand({ Bucket }));
		expect(tags.TagSet).toContainEqual({
			Key: 'gkm:project',
			Value: `${project}/${project}`,
		});

		expect((await open().read(STAGE))?.state).toEqual(busyState(STAGE));
	});

	it('reuses the bucket on the next open, creating nothing', async () => {
		const first = open();
		await (await first.lock(STAGE)).release();
		creates = [];

		const second = open();
		const lock = await second.lock(STAGE);
		await second.write(STAGE, busyState(STAGE), { expectedVersion: null });
		await lock.release();

		expect(creates).toEqual([]);
	});

	it('never creates it on a read: the stage has no state yet', async () => {
		const store = open();

		expect(await store.read(STAGE)).toBeNull();
		expect(await store.forceUnlock(STAGE)).toBeNull();
		expect(creates).toEqual([]);
		expect(await exists()).toBe(false);
	});

	it('refuses a name another account holds, and touches nothing of it', async () => {
		server.use(
			http.head(
				`${LOCALSTACK_URL}/${bucketOf()}`,
				() => new HttpResponse(null, { status: 403 }),
			),
		);

		const reading = await open()
			.read(STAGE)
			.catch((e: unknown) => e);
		const locking = await open()
			.lock(STAGE)
			.catch((e: unknown) => e);

		expect(reading).toBeInstanceOf(ProjectBucketTaken);
		expect(locking).toBeInstanceOf(ProjectBucketTaken);
		expect((locking as ProjectBucketTaken).message).toMatch(
			/state: \{ provider: 's3', bucket:/,
		);
		expect(creates).toEqual([]);
	});

	it('holds a busy stage and keeps runs to one at a time', async () => {
		const store = open();
		const lock = await store.lock(STAGE, { operation: 'deploy' });
		let version = await store.write(STAGE, busyState(STAGE), {
			expectedVersion: null,
		});
		for (const record of busyResources(STAGE, { perApp: true })) {
			version = await store.putResource(STAGE, record, {
				expectedVersion: version,
			});
		}

		await expect(open().lock(STAGE)).rejects.toBeInstanceOf(StateLocked);
		await lock.release();

		const read = await open().read(STAGE);
		expect(read?.state).toEqual(busyState(STAGE));
		expect(Object.keys(read?.resources ?? {})).toHaveLength(
			Object.keys(busyDocument(STAGE, { perApp: true }).resources).length,
		);
	});
});

describe(
	'the project bucket, as S3 answers for it',
	{ timeout: 60_000 },
	() => {
		const bucketUrl = () => `${LOCALSTACK_URL}/${bucketOf()}`;
		const s3Error = (code: string, status: number) =>
			HttpResponse.xml(
				`<Error><Code>${code}</Code><Message>${code}</Message></Error>`,
				{ status },
			);
		/** Answers the bucket's CreateBucket with `answer`; its config puts pass. */
		const onCreate = (
			answer: (request: Request) => Response | Promise<Response>,
		) =>
			server.use(
				http.put(bucketUrl(), ({ request }) =>
					new URL(request.url).search === '' ? answer(request) : passthrough(),
				),
			);
		const ensure = (region = REGION) =>
			ensureProjectBucket(
				new S3Client({
					region,
					endpoint: LOCALSTACK_URL,
					forcePathStyle: true,
					credentials,
				}),
				{
					bucket: bucketOf(),
					region,
					identity: { key: `${project}/${project}` },
				},
			);

		it('refuses a bucket in another region by saying so', async () => {
			server.use(
				http.head(bucketUrl(), () => new HttpResponse(null, { status: 301 })),
			);

			const refused = await findProjectBucket(s3, bucketOf()).catch(
				(e: unknown) => e,
			);

			expect(refused).toBeInstanceOf(ProjectBucketTaken);
			expect(refused).toMatchObject({ status: 301 });
			expect((refused as Error).message).toContain('another region');
		});

		it('passes any other HEAD failure through', async () => {
			server.use(
				http.head(bucketUrl(), () => new HttpResponse(null, { status: 500 })),
			);

			await expect(findProjectBucket(s3, bucketOf())).rejects.toMatchObject({
				$metadata: { httpStatusCode: 500 },
			});
		});

		it('configures a bucket another run created a moment ago', async () => {
			onCreate(async (request) => {
				await fetch(bypass(request));
				return s3Error('BucketAlreadyOwnedByYou', 409);
			});

			expect(await ensure()).toEqual({ created: true });

			const versioning = await s3.send(
				new GetBucketVersioningCommand({ Bucket: bucketOf() }),
			);
			expect(versioning.Status).toBe('Enabled');
		});

		it('refuses a name another account created first', async () => {
			onCreate(() => s3Error('BucketAlreadyExists', 409));

			await expect(ensure()).rejects.toMatchObject({
				name: 'ProjectBucketTaken',
				status: 409,
			});
		});

		it('refuses credentials that may not create it, naming how to', async () => {
			onCreate(() => s3Error('AccessDenied', 403));

			const refused = await ensure().catch((e: unknown) => e);

			expect(refused).toBeInstanceOf(ProjectBucketNotCreatable);
			expect((refused as Error).message).toContain('gkm deploy:github');
		});

		it('passes any other create failure through', async () => {
			onCreate(() => s3Error('InternalError', 500));

			await expect(ensure()).rejects.toMatchObject({ name: 'InternalError' });
		});

		it('creates it in us-east-1 with no location constraint', async () => {
			const created: (string | null)[] = [];
			onCreate(async (request) => {
				created.push(await request.clone().text());
				return fetch(bypass(request));
			});

			expect(await ensure('us-east-1')).toEqual({ created: true });
			expect(created).toEqual(['']);
			expect(await exists()).toBe(true);
		});
	},
);
