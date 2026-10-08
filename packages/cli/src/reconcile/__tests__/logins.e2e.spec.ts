/**
 * The generated logins against the real containers: reconcile, with real
 * Docker, starting this project's own Postgres and MinIO under a compose
 * project of their own — and an older gkm's volume, made with the old fixed
 * login, brought onto the generated one with its data kept.
 *
 * Gated behind GKM_E2E=1: it pulls and starts containers. Torn down, volumes
 * included, whatever happens — only the compose project it made.
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
	CreateBucketCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import type { ConstructManifest } from '@geekmidas/manifest';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { primaryPortKey } from '../containers';
import { composeFiles, dockerCli } from '../docker';
import { COMPOSE_PATH, type ReconcileResult, reconcile } from '../index';
import {
	generateLocalCredentials,
	type LocalCredentials,
	type Login,
} from '../localCredentials';
import { LEGACY_LOCAL_LOGIN, minioAccepts } from '../logins';

const run = promisify(execFile);
const e2e = process.env.GKM_E2E === '1';

/** A database without roles: its URL connects as the cluster's superuser. */
const manifest = {
	Orders: {
		kind: 'database',
		id: 'Orders',
		roles: false,
		provides: ['ORDERS_URL'],
	},
	Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
} as unknown as ConstructManifest;

/** What an older gkm brought every container up with. */
function legacyCredentials(): LocalCredentials {
	return {
		...generateLocalCredentials('logins'),
		postgres: LEGACY_LOCAL_LOGIN,
		minio: LEGACY_LOCAL_LOGIN,
	};
}

/** Whether `login` opens the Postgres on `port`. */
async function opens(port: number, login: Login): Promise<boolean> {
	const client = new Client({
		host: 'localhost',
		port,
		user: login.user,
		password: login.password,
		database: 'postgres',
	});
	try {
		await client.connect();
		return true;
	} catch {
		return false;
	} finally {
		await client.end().catch(() => {});
	}
}

async function query(
	port: number,
	login: Login,
	database: string,
	sql: string,
) {
	const client = new Client({
		host: 'localhost',
		port,
		user: login.user,
		password: login.password,
		database,
	});
	await client.connect();
	try {
		return (await client.query(sql)).rows;
	} finally {
		await client.end();
	}
}

function s3(port: number, login: Login): S3Client {
	return new S3Client({
		region: 'us-east-1',
		endpoint: `http://localhost:${port}`,
		forcePathStyle: true,
		credentials: { accessKeyId: login.user, secretAccessKey: login.password },
	});
}

describe.skipIf(!e2e)('local logins against real containers', () => {
	let root: string;
	let project: string;

	const reconcileWith = (credentials: LocalCredentials) =>
		reconcile({
			root,
			project,
			manifest,
			stage: 'dev',
			localStage: 'dev',
			credentials,
			docker: dockerCli,
		});

	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), 'gkm-logins-'));
		project = `gkm-logins-${randomBytes(4).toString('hex')}`;
	});

	afterAll(async () => {
		await run('docker', [
			'compose',
			...composeFiles(join(root, COMPOSE_PATH)),
			'down',
			'-v',
			'--remove-orphans',
		]).catch(() => {});
		await rm(root, { recursive: true, force: true });
	}, 120_000);

	describe('a volume an older gkm made with the old fixed login', () => {
		let before: ReconcileResult;
		let after: ReconcileResult;
		let generated: LocalCredentials;
		let postgres: number;
		let minio: number;

		beforeAll(async () => {
			// An older gkm: every container up with the fixed login, and data in
			// each.
			before = await reconcileWith(legacyCredentials());
			postgres = before.ports[primaryPortKey('postgres')]!;
			minio = before.ports[primaryPortKey('minio')]!;
			await query(
				postgres,
				LEGACY_LOCAL_LOGIN,
				'orders',
				"CREATE TABLE kept (note text); INSERT INTO kept VALUES ('still here')",
			);
			await s3(minio, LEGACY_LOCAL_LOGIN).send(
				new PutObjectCommand({
					Bucket: 'uploads',
					Key: 'kept.txt',
					Body: 'still here',
				}),
			);

			// The upgrade: the same project, its logins generated.
			generated = generateLocalCredentials('logins');
			after = await reconcileWith(generated);
		}, 300_000);

		it('rotates Postgres to the generated superuser, and says so', () => {
			expect(
				after.logins.find((outcome) => outcome.service === 'postgres'),
			).toMatchObject({ status: 'rotated', login: generated.postgres });
			expect(after.credentials.postgres).toEqual(generated.postgres);
		});

		it('keeps the data', async () => {
			expect(
				await query(
					postgres,
					generated.postgres,
					'orders',
					'SELECT note FROM kept',
				),
			).toEqual([{ note: 'still here' }]);
			const object = await s3(minio, generated.minio).send(
				new GetObjectCommand({ Bucket: 'uploads', Key: 'kept.txt' }),
			);
			expect(await object.Body?.transformToString()).toBe('still here');
		});

		it('takes the generated login, and no longer the old one', async () => {
			expect(await opens(postgres, generated.postgres)).toBe(true);
			expect(await opens(postgres, LEGACY_LOCAL_LOGIN)).toBe(false);
			expect(await minioAccepts(minio, generated.minio)).toBe(true);
			expect(await minioAccepts(minio, LEGACY_LOCAL_LOGIN)).toBe(false);
		});

		it('hands the app the rotated login', async () => {
			const url = new URL(after.env.ORDERS_URL!);
			expect(url.username).toBe(generated.postgres.user);
			const rows = await query(
				Number(url.port),
				{
					user: url.username,
					password: decodeURIComponent(url.password),
				},
				'orders',
				'SELECT note FROM kept',
			);
			expect(rows).toEqual([{ note: 'still here' }]);
		});

		it('resets a password another checkout changed, from inside the container', async () => {
			// Nothing this workspace knows opens it over TCP any more.
			await run('docker', [
				'compose',
				...composeFiles(join(root, COMPOSE_PATH)),
				'exec',
				'-T',
				'postgres',
				'psql',
				'-U',
				generated.postgres.user,
				'-d',
				'postgres',
				'-c',
				`ALTER ROLE "${generated.postgres.user}" PASSWORD 'someone-elses'`,
			]);
			expect(await opens(postgres, generated.postgres)).toBe(false);

			// A change that is not converged, so reconcile checks again.
			await rm(join(root, '.gkm', 'reconcile'), {
				recursive: true,
				force: true,
			});
			const again = await reconcileWith(generated);

			expect(
				again.logins.find((outcome) => outcome.service === 'postgres')?.status,
			).toBe('rotated');
			expect(await opens(postgres, generated.postgres)).toBe(true);
			expect(
				await query(
					postgres,
					generated.postgres,
					'orders',
					'SELECT note FROM kept',
				),
			).toEqual([{ note: 'still here' }]);
		}, 300_000);
	});
});

describe.skipIf(!e2e)('a fresh workspace’s containers', () => {
	let root: string;
	let result: ReconcileResult;
	const credentials = generateLocalCredentials('fresh');

	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), 'gkm-logins-fresh-'));
		result = await reconcile({
			root,
			project: `gkm-logins-fresh-${randomBytes(4).toString('hex')}`,
			manifest,
			stage: 'dev',
			localStage: 'dev',
			credentials,
			docker: dockerCli,
		});
	}, 300_000);

	afterAll(async () => {
		await run('docker', [
			'compose',
			...composeFiles(join(root, COMPOSE_PATH)),
			'down',
			'-v',
			'--remove-orphans',
		]).catch(() => {});
		await rm(root, { recursive: true, force: true });
	}, 120_000);

	it('are brought up with the generated logins, which open them', async () => {
		const postgres = result.ports[primaryPortKey('postgres')]!;
		const minio = result.ports[primaryPortKey('minio')]!;

		expect(result.logins.map((outcome) => outcome.status)).toEqual([
			'current',
			'current',
		]);
		expect(await opens(postgres, credentials.postgres)).toBe(true);
		expect(await minioAccepts(minio, credentials.minio)).toBe(true);
		await s3(minio, credentials.minio).send(
			new CreateBucketCommand({ Bucket: 'fresh-check' }),
		);
	});

	it('refuse the old fixed login', async () => {
		const postgres = result.ports[primaryPortKey('postgres')]!;
		const minio = result.ports[primaryPortKey('minio')]!;

		expect(await opens(postgres, LEGACY_LOCAL_LOGIN)).toBe(false);
		expect(
			await opens(postgres, {
				user: credentials.postgres.user,
				password: LEGACY_LOCAL_LOGIN.password,
			}),
		).toBe(false);
		expect(await minioAccepts(minio, LEGACY_LOCAL_LOGIN)).toBe(false);
	});
});
