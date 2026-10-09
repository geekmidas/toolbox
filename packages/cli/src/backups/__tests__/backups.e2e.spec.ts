/**
 * The stack's backups container, end to end: a real Postgres in a compose
 * project of its own, the backups image built from the files the stack
 * writes, and the AWS emulator as S3.
 *
 * Gated behind GKM_E2E=1 — it builds an image (installing Node into the
 * stack's Postgres image) and starts two containers. It needs Docker and
 * the network.
 *
 * - a seeded database is backed up by the container's runner, `docker exec`'d
 *   the way `gkm backup:now` does it, into `<prefix>/<day>/<time>/database.sql.gz`;
 * - `backup:list` reads them back, newest first;
 * - the database is emptied, and `backup:restore --latest` — a fresh backup
 *   first, then the file streamed from S3 into a one-off container of the
 *   backups image on the stack's network — brings the rows back;
 * - the container is healthy, and logged each run as a JSON line.
 *
 * The project, its volume and its image are removed whatever happens.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	DeleteBucketCommand,
	DeleteObjectsCommand,
	ListObjectVersionsCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import type { ConstructManifest } from '@geekmidas/manifest';
import * as s3Url from '@geekmidas/storage/s3-url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
	LOCALSTACK_PORT,
	LOCALSTACK_URL,
} from '../../../../testkit/test/ports';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import { dockerCompose, type StackRef } from '../../compose/docker';
import { type ComposeStack, composeStack, envFile } from '../../compose/stack';
import { deployIdentity } from '../../deploy/identity';
import {
	ensureProjectBucket,
	projectBucketName,
} from '../../providers/projectBucket';
import { pgClient } from '../../reconcile/clients';
import { applyPostgres } from '../../reconcile/provision';
import { initStageSecrets } from '../../secrets/storage';
import type { NormalizedWorkspace } from '../../workspace/types';
import { backupNow, listBackups, restoreBackup } from '../commands';
import { BACKUPS_SERVICE, backupsRoleStatements } from '../service';

const RUN = process.env.GKM_E2E === '1';
const REGION = 'eu-west-1';
const STAGE = 'production';

const s3 = new S3Client({
	region: REGION,
	endpoint: LOCALSTACK_URL,
	forcePathStyle: true,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let stack: ComposeStack;
let ref: StackRef;
let bucket: string;
let port: number;

function docker(args: readonly string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn('docker', [...args], {
			cwd: dir,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		child.stdout.on('data', (c: Buffer) => {
			output += c.toString();
		});
		child.stderr.on('data', (c: Buffer) => {
			output += c.toString();
		});
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0
				? resolve(output)
				: reject(
						new Error(`docker ${args.join(' ')} exited ${code}:\n${output}`),
					),
		);
	});
}

/** A query as the stack's superuser, in `database`. */
async function sql<T = Record<string, unknown>>(
	database: string,
	text: string,
): Promise<T[]> {
	const client = new Client({
		host: '127.0.0.1',
		port,
		user: stack.credential.containers.postgres.user,
		password: stack.credential.containers.postgres.password,
		database,
	});
	await client.connect();
	try {
		return (await client.query(text)).rows as T[];
	} finally {
		await client.end();
	}
}

describe.runIf(RUN)('the backups container', () => {
	beforeAll(async () => {
		dir = realpathSync(await createTempDir('gkm-backups-e2e-'));
		const name = `bke2e-${Date.now().toString(36)}`;
		writeComposeApp(dir, { name, target: 'compose' });
		let runnables: Record<string, string[]>;
		let background: Record<string, string[]>;
		({ workspace, manifest, runnables, background } =
			await loadComposeApp(dir));

		bucket = projectBucketName(
			deployIdentity(workspace, '').scope,
			'000000000000',
		);
		await ensureProjectBucket(s3, {
			bucket,
			region: REGION,
			identity: deployIdentity(workspace, STAGE),
		});

		// The key as the deploy writes it — the emulator, as the container
		// reaches it, across the host gateway.
		const backupsUrl = s3Url.build({
			bucket,
			region: REGION,
			endpoint: `http://host.docker.internal:${LOCALSTACK_PORT}`,
			forcePathStyle: true,
			accessKeyId: 'test',
			secretAccessKey: 'test',
		});
		stack = composeStack({
			workspace,
			manifest,
			runnables,
			background,
			stage: STAGE,
			identity: deployIdentity(workspace, STAGE),
			images: { mode: 'pull', tag: 'e2e' },
			secrets: {
				...initStageSecrets(STAGE),
				seed: 'an-e2e-seed',
				custom: {
					AUTH_SECRET: 'an-e2e-signing-secret',
					REDIS_PASSWORD: 'an-e2e-redis-password',
					BACKUPS_URL: backupsUrl,
				},
			},
		});

		// The stack's Postgres and its backups, exactly as rendered — and the
		// host gateway, which is where the emulator is from inside Docker.
		const backups = stack.backups!;
		const compose = {
			name: stack.project,
			services: {
				postgres: stack.compose.services.postgres,
				[BACKUPS_SERVICE]: {
					...stack.compose.services[BACKUPS_SERVICE],
					extra_hosts: ['host.docker.internal:host-gateway'],
				},
			},
			volumes: { 'postgres-data': {} },
		};
		writeFileSync(join(dir, 'docker-compose.yml'), stringify(compose));
		mkdirSync(join(dir, BACKUPS_SERVICE), { recursive: true });
		for (const [file, content] of Object.entries(backups.files)) {
			writeFileSync(join(dir, BACKUPS_SERVICE, file), content);
		}
		writeFileSync(join(dir, `${BACKUPS_SERVICE}.env`), envFile(backups.env));

		ref = {
			project: stack.project,
			file: join(dir, 'docker-compose.yml'),
			cwd: dir,
			output: 'ignore',
		};
		await dockerCompose.up(ref, ['postgres']);
		port = await dockerCompose.port(ref, 'postgres', 5432);

		// What a deploy's provisioning creates: the database, and the
		// backups role. Then a table, and rows in it.
		const database = backups.databases[0]!.name;
		await sql('postgres', `CREATE DATABASE "${database}"`);
		await applyPostgres(
			pgClient(port, stack.credential.containers.postgres),
			backupsRoleStatements(backups),
		);
		await sql(
			database,
			"CREATE TABLE notes (id serial PRIMARY KEY, body text); INSERT INTO notes (body) VALUES ('first'), ('second')",
		);

		await dockerCompose.up(ref);
	}, 15 * 60_000);

	afterAll(async () => {
		if (ref) {
			await docker([
				'compose',
				'-p',
				ref.project,
				'-f',
				ref.file,
				'down',
				'-v',
				'--rmi',
				'local',
			]).catch(() => {});
		}
		if (bucket) {
			const versions = await s3
				.send(new ListObjectVersionsCommand({ Bucket: bucket }))
				.catch(() => undefined);
			const objects = [
				...(versions?.Versions ?? []),
				...(versions?.DeleteMarkers ?? []),
			].map((v) => ({ Key: v.Key!, VersionId: v.VersionId }));
			if (objects.length > 0) {
				await s3.send(
					new DeleteObjectsCommand({
						Bucket: bucket,
						Delete: { Objects: objects },
					}),
				);
			}
			await s3
				.send(new DeleteBucketCommand({ Bucket: bucket }))
				.catch(() => {});
		}
		if (dir) await cleanupDir(dir);
	}, 120_000);

	it(
		'backs up each database into a day and time folder, listed newest first',
		async () => {
			const prefix = stack.backups!.prefix;
			const before = new Date();
			await backupNow({ docker: dockerCompose, project: stack.project });
			await new Promise((resolve) => setTimeout(resolve, 1100));
			await backupNow({ docker: dockerCompose, project: stack.project });

			const runs = await listBackups(s3, bucket, prefix);
			expect(runs).toHaveLength(2);
			expect(runs[0]!.at.getTime()).toBeGreaterThan(runs[1]!.at.getTime());
			for (const run of runs) {
				expect(run.folder).toMatch(/^\d{4}-\d{2}-\d{2}\/\d{2}-\d{2}-\d{2}Z$/);
				expect(run.at.getTime()).toBeGreaterThanOrEqual(
					Math.floor(before.getTime() / 1000) * 1000,
				);
				expect(run.files).toEqual([
					{ database: 'database', size: expect.any(Number) },
				]);
				expect(run.files[0]!.size).toBeGreaterThan(100);
			}
			expect(prefix).toBe(`gkm/${workspace.name}/${STAGE}/backups`);

			const container = await dockerCompose.container(
				{},
				stack.project,
				BACKUPS_SERVICE,
			);
			const logs = await docker(['logs', container!.id]);
			const finished = logs
				.split('\n')
				.filter((line) => line.startsWith('{'))
				.map((line) => JSON.parse(line))
				.filter((line) => line.msg === 'backup finished');
			expect(finished).toHaveLength(2);
			expect(finished[0]).toMatchObject({
				level: 'info',
				ok: true,
				databases: ['database'],
				folder: `${prefix}/${runs[1]!.folder}`,
			});

			const health = await dockerCompose.exec(ref, BACKUPS_SERVICE, [
				'node',
				'/gkm/backup.mjs',
				'health',
			]);
			expect(health.code).toBe(0);
		},
		5 * 60_000,
	);

	it(
		'restores the latest backup into an emptied database, after taking a fresh one',
		async () => {
			const database = stack.backups!.databases[0]!.name;
			await sql(database, 'DROP TABLE notes');
			const asked: string[] = [];

			const { run, restored } = await restoreBackup({
				s3,
				bucket,
				prefix: stack.backups!.prefix,
				docker: dockerCompose,
				project: stack.project,
				stage: STAGE,
				superuser: stack.credential.containers.postgres,
				databases: stack.backups!.databases,
				latest: true,
				confirm: async (question) => {
					asked.push(question);
					return true;
				},
				log: () => {},
				output: 'ignore',
			});

			expect(asked).toHaveLength(1);
			expect(restored).toEqual(['database']);
			expect(
				await sql<{ body: string }>(
					database,
					'SELECT body FROM notes ORDER BY id',
				),
			).toEqual([{ body: 'first' }, { body: 'second' }]);

			// The backup taken first is the newest now — of the emptied database.
			const runs = await listBackups(s3, bucket, stack.backups!.prefix);
			expect(runs).toHaveLength(3);
			expect(runs[1]!.folder).toBe(run.folder);
		},
		5 * 60_000,
	);
});
