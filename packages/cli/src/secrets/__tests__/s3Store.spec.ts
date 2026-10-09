/**
 * A stage's secrets in S3, beside the deploy state in the project bucket: the
 * store itself, the commands that read and write it, the copy from SSM, and
 * the config that names it.
 *
 * Against the AWS emulator — its S3, STS and SSM — through the SDK's standard
 * endpoint variable. Requires: docker compose up -d localstack
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	CreateBucketCommand,
	GetBucketEncryptionCommand,
	GetBucketTaggingCommand,
	GetBucketVersioningCommand,
	GetObjectCommand,
	GetPublicAccessBlockCommand,
	HeadBucketCommand,
	HeadObjectCommand,
	ListObjectVersionsCommand,
	S3Client,
} from '@aws-sdk/client-s3';
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
import { ConfigLoadFailed, loadWorkspaceConfig } from '../../config';
import { deployIdentity } from '../../deploy/identity';
import { projectBucket } from '../../providers/projectBucket';
import { type StageKeyJson, secretsAddCommand } from '../add';
import { AwsSecretsStore, SSM_PARAMETER_LIMIT } from '../aws';
import { StageSecretsUnreadable } from '../awsStore';
import { createStageSecrets } from '../generator';
import {
	secretsInitCommand,
	secretsSetCommand,
	secretsShowCommand,
	secretsUnsetCommand,
} from '../index';
import {
	MigrateTargetHoldsStage,
	MigrateTargetIsSource,
	secretsMigrateCommand,
} from '../migrate';
import { S3SecretsStore, StageSecretsChanged } from '../s3';
import { initStageSecrets } from '../storage';
import { secretsStoreFor } from '../store';
import type { StageSecrets } from '../types';
import { writeServicesApp } from './__helpers__/servicesApp';

const REGION = 'eu-west-1';
const ACCOUNT = '000000000000';
const STAGE = 'production';

const EMULATOR = {
	AWS_ENDPOINT_URL: LOCALSTACK_URL,
	AWS_ACCESS_KEY_ID: 'test',
	AWS_SECRET_ACCESS_KEY: 'test',
};
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
	for (const [key, value] of Object.entries(EMULATOR)) {
		saved[key] = process.env[key];
		process.env[key] = value;
	}
});

afterAll(() => {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

const s3 = new S3Client({
	region: REGION,
	endpoint: LOCALSTACK_URL,
	forcePathStyle: true,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

/** A project of its own per test: the emulator outlives the suite. */
const newProject = () => `sec-${randomUUID().slice(0, 8)}`;
const bucketOf = (project: string) =>
	projectBucket({ name: project }, { accountId: ACCOUNT });
const exists = (Bucket: string) =>
	s3.send(new HeadBucketCommand({ Bucket })).then(
		() => true,
		() => false,
	);

function open(project: string, bucket?: string): S3SecretsStore {
	return new S3SecretsStore({
		project,
		identity: deployIdentity({ name: project }, ''),
		region: REGION,
		prefix: 'gkm',
		...(bucket ? { bucket } : {}),
	});
}

/** A stage with every part a store must keep. */
function fullStage(): StageSecrets {
	const secrets = createStageSecrets(STAGE, ['postgres', 'redis', 'minio'], {
		projectName: 'shop',
	});
	secrets.custom = {
		STRIPE_KEY: 'sk_live_1',
		SHIPPING_CREDENTIALS: JSON.stringify({ apiKey: 'sk_x', accountId: '7' }),
	};
	secrets.seed = 'a'.repeat(64);
	return secrets;
}

describe('S3SecretsStore', { timeout: 60_000 }, () => {
	let project: string;
	beforeEach(() => {
		project = newProject();
	});

	it('round-trips a whole stage', async () => {
		const secrets = fullStage();

		await open(project).write(STAGE, secrets);

		expect(await open(project).read(STAGE)).toEqual(secrets);
		const object = await s3.send(
			new GetObjectCommand({
				Bucket: bucketOf(project),
				Key: `gkm/${project}/${STAGE}/secrets.json`,
			}),
		);
		expect(JSON.parse(await object.Body!.transformToString())).toEqual(secrets);
	});

	it('reads no secrets, and creates nothing, while there is no bucket or object', async () => {
		const store = open(project);

		expect(await store.read(STAGE)).toBeNull();
		expect(await exists(bucketOf(project))).toBe(false);

		await open(project).write('staging', initStageSecrets('staging'));
		expect(await open(project).read(STAGE)).toBeNull();
	});

	it('creates the project bucket on the first write, as the state store does', async () => {
		await open(project).write(STAGE, initStageSecrets(STAGE));

		const Bucket = bucketOf(project);
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
		expect(block.PublicAccessBlockConfiguration?.BlockPublicAcls).toBe(true);
		const tags = await s3.send(new GetBucketTaggingCommand({ Bucket }));
		expect(tags.TagSet).toContainEqual({
			Key: 'gkm:project',
			Value: `${project}/${project}`,
		});
	});

	it('asks for SSE-S3 on every write, and the object carries it', async () => {
		const store = open(project);
		const client = await (
			store as unknown as { client(): Promise<{ s3: S3Client }> }
		).client();
		const puts: Record<string, unknown>[] = [];
		client.s3.middlewareStack.add(
			(next, context) => async (args) => {
				if (context.commandName === 'PutObjectCommand') {
					puts.push(args.input as Record<string, unknown>);
				}
				return next(args);
			},
			{ step: 'initialize' },
		);

		await store.write(STAGE, initStageSecrets(STAGE));

		expect(puts).toHaveLength(1);
		expect(puts[0]).toMatchObject({ ServerSideEncryption: 'AES256' });
		const head = await s3.send(
			new HeadObjectCommand({
				Bucket: bucketOf(project),
				Key: `gkm/${project}/${STAGE}/secrets.json`,
			}),
		);
		expect(head.ServerSideEncryption).toBe('AES256');
	});

	it('refuses a write on a stale read, by name, and keeps the other run’s', async () => {
		await open(project).write(STAGE, initStageSecrets(STAGE));
		const first = open(project);
		const second = open(project);
		const base = (await first.read(STAGE))!;
		await second.read(STAGE);

		const theirs = { ...base, custom: { A: 'first' } };
		await first.write(STAGE, theirs);
		const refused = await second
			.write(STAGE, { ...base, custom: { B: 'second' } })
			.catch((e: unknown) => e);

		expect(refused).toBeInstanceOf(StageSecretsChanged);
		expect(refused).toMatchObject({
			stage: STAGE,
			location: `s3://${bucketOf(project)}/gkm/${project}/${STAGE}/secrets.json`,
		});
		expect(await open(project).read(STAGE)).toEqual(theirs);
	});

	it('refuses the second of two first writes', async () => {
		const first = open(project);
		const second = open(project);
		expect(await first.read(STAGE)).toBeNull();
		expect(await second.read(STAGE)).toBeNull();

		await first.write(STAGE, initStageSecrets(STAGE));

		await expect(
			second.write(STAGE, initStageSecrets(STAGE)),
		).rejects.toBeInstanceOf(StageSecretsChanged);
	});

	it('writes on top of its own last write, and the bucket keeps each version', async () => {
		const store = open(project);
		const first = initStageSecrets(STAGE);
		await store.write(STAGE, first);
		await store.write(STAGE, { ...first, custom: { ROTATED: 'yes' } });

		const versions = await s3.send(
			new ListObjectVersionsCommand({
				Bucket: bucketOf(project),
				Prefix: `gkm/${project}/${STAGE}/secrets.json`,
			}),
		);
		expect(versions.Versions).toHaveLength(2);
	});

	it('holds a stage past any SSM parameter', async () => {
		const secrets = initStageSecrets(STAGE);
		secrets.custom = { BLOB: 'x'.repeat(SSM_PARAMETER_LIMIT * 4) };

		await open(project).write(STAGE, secrets);

		expect(await open(project).read(STAGE)).toEqual(secrets);
	});

	it('keeps a stage in a bucket the config names, and creates no other', async () => {
		const Bucket = `named-${project}`;
		await s3.send(
			new CreateBucketCommand({
				Bucket,
				CreateBucketConfiguration: { LocationConstraint: REGION },
			}),
		);
		const secrets = fullStage();

		expect(await open(project, Bucket).read(STAGE)).toBeNull();
		await open(project, Bucket).write(STAGE, secrets);

		expect(await open(project, Bucket).read(STAGE)).toEqual(secrets);
		expect(await exists(bucketOf(project))).toBe(false);
	});

	describe('with no AWS credentials on this machine', () => {
		beforeEach(() => {
			for (const key of [
				'AWS_ACCESS_KEY_ID',
				'AWS_SECRET_ACCESS_KEY',
				'AWS_SESSION_TOKEN',
				'AWS_PROFILE',
				'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
				'AWS_CONTAINER_CREDENTIALS_FULL_URI',
				'AWS_WEB_IDENTITY_TOKEN_FILE',
			]) {
				vi.stubEnv(key, undefined);
			}
			vi.stubEnv('AWS_CONFIG_FILE', '/dev/null');
			vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', '/dev/null');
			vi.stubEnv('AWS_EC2_METADATA_DISABLED', 'true');
			vi.stubEnv('AWS_ENDPOINT_URL', 'http://127.0.0.1:1');
		});

		afterEach(() => vi.unstubAllEnvs());

		for (const [label, bucket] of [
			['the project bucket', undefined],
			['a named bucket', 'acme-ops'],
		] as const) {
			it(`${label}: refuses a read and a write by name`, async () => {
				const store = open(project, bucket);

				const read = store.read(STAGE);
				await expect(read).rejects.toBeInstanceOf(StageSecretsUnreadable);
				await expect(read).rejects.toMatchObject({
					stage: STAGE,
					store: 's3',
					access: 'read',
					reason: 'no-credentials',
					message: expect.stringContaining('kept in S3'),
				});

				await expect(
					store.write(STAGE, initStageSecrets(STAGE)),
				).rejects.toMatchObject({
					name: 'StageSecretsUnreadable',
					access: 'write',
				});
			});
		}
	});
});

/** What `process.exit` becomes here, so a refusal can be asserted on. */
class Exited extends Error {
	constructor(readonly code: number | undefined) {
		super(`process.exit(${code})`);
		this.name = 'Exited';
	}
}

describe(
	'a workspace keeping its secrets in the project bucket',
	{
		timeout: 60_000,
	},
	() => {
		let dir: string;
		let home: string;
		let cwd: string;
		let name: string;
		let log: ReturnType<typeof vi.spyOn>;
		const printed = () => log.mock.calls.flat().join('\n');

		const S3_STATE = { provider: 's3', region: REGION };
		const S3_SECRETS = { store: { provider: 's3' } };
		const SSM_SECRETS = { store: { provider: 'ssm', region: REGION } };

		function writeConfig(secrets: Record<string, unknown>, state?: unknown) {
			writeServicesApp(dir, {
				name,
				secrets,
				...(state ? { state: state as Record<string, unknown> } : {}),
			});
		}

		const inS3 = (stage = STAGE) => open(name).read(stage);
		const inSsm = (stage = STAGE) =>
			new AwsSecretsStore({ project: name, region: REGION }).read(stage);

		beforeEach(() => {
			dir = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-s3-secrets-')));
			home = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-s3-secrets-home-')));
			vi.stubEnv('GKM_HOME', home);
			name = newProject();
			cwd = process.cwd();
			process.chdir(dir);
			log = vi.spyOn(console, 'log').mockImplementation(() => {});
			vi.spyOn(console, 'error').mockImplementation(() => {});
			vi.spyOn(process, 'exit').mockImplementation((code) => {
				throw new Exited(code as number | undefined);
			});
		});

		afterEach(() => {
			process.chdir(cwd);
			vi.restoreAllMocks();
			vi.unstubAllEnvs();
			rmSync(dir, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		});

		it('resolves a deployed stage to S3 in the state’s region, and the local one to the file', async () => {
			writeConfig(S3_SECRETS, S3_STATE);
			const { workspace } = await loadWorkspaceConfig(dir);

			const store = await secretsStoreFor(workspace, STAGE);
			expect(store).toBeInstanceOf(S3SecretsStore);
			expect(
				(store as unknown as { options: { region: string } }).options.region,
			).toBe(REGION);
			expect((await secretsStoreFor(workspace, 'development')).name).toBe(
				'file',
			);
		});

		it('refuses an s3 store with no region to name or inherit', async () => {
			writeConfig(S3_SECRETS);

			const refused = await loadWorkspaceConfig(dir).catch((e) => e);

			expect(refused).toBeInstanceOf(ConfigLoadFailed);
			expect(refused.message).toContain(
				"secrets.store is { provider: 's3' } with no region",
			);
		});

		it('secrets:init, set, show and unset a stage there', async () => {
			writeConfig(S3_SECRETS, S3_STATE);

			await secretsInitCommand({ stage: STAGE });
			expect(printed()).toContain('Store: s3');

			await secretsSetCommand('STRIPE_KEY', 'sk_live_s3', { stage: STAGE });
			await secretsSetCommand('DROP_ME', 'x', { stage: STAGE });
			expect(printed()).toContain(
				`Secret "STRIPE_KEY" set for stage "${STAGE}" (s3)`,
			);
			expect((await inS3())?.custom.STRIPE_KEY).toBe('sk_live_s3');

			await secretsShowCommand({ stage: STAGE, reveal: true });
			expect(printed()).toContain('STRIPE_KEY: sk_live_s3');

			await secretsUnsetCommand('DROP_ME', { stage: STAGE });
			expect((await inS3())?.custom).not.toHaveProperty('DROP_ME');
			expect((await inS3())?.custom.STRIPE_KEY).toBe('sk_live_s3');
		});

		it('secrets:add --json lists the stage’s keys from S3', async () => {
			writeConfig(S3_SECRETS, S3_STATE);
			await secretsInitCommand({ stage: STAGE });
			await secretsSetCommand('MAIL_URL', 'smtp://u:p@mail.example.com:587', {
				stage: STAGE,
			});
			const written: string[] = [];

			await secretsAddCommand(
				{ stage: STAGE, json: true, cwd: dir, home },
				{
					log: () => {},
					write: (chunk) => written.push(chunk),
					interactive: false,
				},
			);

			const keys = JSON.parse(written.join('')) as StageKeyJson[];
			expect(keys.find((k) => k.key === 'MAIL_URL')).toMatchObject({
				set: true,
			});
			expect(keys.some((k) => !k.set)).toBe(true);
		});

		it('secrets:migrate --to s3 copies a stage from SSM whole, verifies it, and leaves SSM alone', async () => {
			writeConfig(SSM_SECRETS, S3_STATE);
			await secretsInitCommand({ stage: STAGE });
			await secretsSetCommand('STRIPE_KEY', 'sk_live_moved', { stage: STAGE });
			const before = await inSsm();

			await secretsMigrateCommand({ stage: STAGE, to: 's3' });

			expect(await inS3()).toEqual(before);
			expect(await inSsm()).toEqual(before);
			expect(printed()).toContain('Verified:');
			expect(printed()).toContain(
				"set secrets.store to { provider: 's3' } in gkm.config.ts",
			);
			expect(printed()).toContain(
				`aws ssm delete-parameter --name /gkm/${name}/${STAGE}/secrets --region ${REGION}`,
			);

			// Again: the target holds the same, so nothing is written.
			log.mockClear();
			await secretsMigrateCommand({ stage: STAGE, to: 's3' });
			expect(printed()).toContain('already holds the same secrets');
			expect(await inSsm()).toEqual(before);
		});

		it('secrets:migrate refuses s3 once the stage is kept there', async () => {
			writeConfig(S3_SECRETS, S3_STATE);

			await expect(
				secretsMigrateCommand({ stage: STAGE, to: 's3' }),
			).rejects.toBeInstanceOf(MigrateTargetIsSource);
		});

		it('secrets:migrate refuses to overwrite different secrets in S3, unless forced', async () => {
			writeConfig(SSM_SECRETS, S3_STATE);
			await secretsInitCommand({ stage: STAGE });
			await open(name).write(STAGE, {
				...initStageSecrets(STAGE),
				custom: { OTHER: 'x' },
			});

			await expect(
				secretsMigrateCommand({ stage: STAGE, to: 's3' }),
			).rejects.toBeInstanceOf(MigrateTargetHoldsStage);

			await secretsMigrateCommand({ stage: STAGE, to: 's3', force: true });
			expect(await inS3()).toEqual(await inSsm());
		});

		it('secrets:migrate --to s3 takes the SSM store’s region when the state is elsewhere', async () => {
			writeConfig(SSM_SECRETS);
			await secretsInitCommand({ stage: STAGE });

			await secretsMigrateCommand({ stage: STAGE, to: 's3' });

			expect(await inS3()).toEqual(await inSsm());
			expect(printed()).toContain(
				`set secrets.store to { provider: 's3', region: '${REGION}' }`,
			);
		});
	},
);
