import { realpathSync } from 'node:fs';
import {
	DeleteAccessKeyCommand,
	DeleteUserCommand,
	DeleteUserPolicyCommand,
	GetUserPolicyCommand,
	IAMClient,
	ListAccessKeysCommand,
	ListUserTagsCommand,
} from '@aws-sdk/client-iam';
import {
	DeleteBucketCommand,
	DeleteObjectsCommand,
	GetBucketLifecycleConfigurationCommand,
	GetObjectCommand,
	ListObjectVersionsCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import type { ConstructManifest } from '@geekmidas/manifest';
import * as s3Url from '@geekmidas/storage/s3-url';
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import { deployIdentity } from '../../deploy/identity';
import { createStateStore } from '../../deploy/StateStore';
import { useNewKeyWaits } from '../../providers/iam';
import { provisionStage, verifyStageProviders } from '../../providers/index';
import {
	ensureProjectBucket,
	NONCURRENT_VERSION_DAYS,
	projectBucketName,
} from '../../providers/projectBucket';
import { secretsStoreFor } from '../../secrets/store';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	BACKUPS_POLICY_NAME,
	backupsPolicy,
	backupsUserName,
	VERIFY_MARKER,
} from '../provision';

/**
 * The deploy's backups step against the AWS emulator the suite runs (floci),
 * through the SDK's own `AWS_ENDPOINT_URL`: the project bucket, its
 * lifecycle, the backups user, its policy and its key are real calls.
 *
 * floci does not enforce IAM — any key signs anything — so that the backups
 * key cannot read, list or delete is asserted as the policy document IAM
 * holds, and that it can put, by putting with it.
 */

const REGION = 'eu-west-1';
const ACCOUNT = '000000000000';

const admin = {
	region: REGION,
	endpoint: LOCALSTACK_URL,
	forcePathStyle: true,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
const s3 = new S3Client(admin);
const iam = new IAMClient(admin);

let dir: string;
let home: string;
let name: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let runnables: Record<string, string[]>;
const lines: string[] = [];

const bucket = () =>
	projectBucketName(deployIdentity(workspace, '').scope, ACCOUNT);
const user = (stage: string) =>
	backupsUserName(deployIdentity(workspace, stage).scope, stage);

async function stateStore() {
	return createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});
}

const provision = async (
	stage: string,
	options: Partial<Parameters<typeof provisionStage>[0]> = {},
) => {
	const store = await secretsStoreFor(workspace, stage, { home });
	return provisionStage({
		workspace,
		stage,
		manifest,
		runnables,
		home,
		secrets: {
			read: () => store.read(stage),
			write: (secrets) => store.write(stage, secrets),
		},
		state: await stateStore(),
		log: (line) => lines.push(line),
		...options,
	});
};

async function secretsOf(stage: string) {
	const store = await secretsStoreFor(workspace, stage, { home });
	return (await store.read(stage))?.custom ?? {};
}

async function keysOf(name: string): Promise<string[]> {
	const listed = await iam.send(new ListAccessKeysCommand({ UserName: name }));
	return (listed.AccessKeyMetadata ?? []).map((k) => k.AccessKeyId!).sort();
}

/** A client signing with the stage's backups key, as the container does. */
async function backupsClient(stage: string) {
	const address = s3Url.parse((await secretsOf(stage)).BACKUPS_URL!);
	return {
		address,
		client: new S3Client({
			region: address.region!,
			endpoint: address.endpoint!,
			forcePathStyle: true,
			credentials: {
				accessKeyId: address.accessKeyId!,
				secretAccessKey: address.secretAccessKey!,
			},
		}),
	};
}

beforeAll(async () => {
	vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
	vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
	vi.stubEnv('AWS_REGION', REGION);
	vi.stubEnv('AWS_PROFILE', undefined);

	dir = realpathSync(await createTempDir('gkm-backups-provision-'));
	home = realpathSync(await createTempDir('gkm-backups-home-'));
	vi.stubEnv('GKM_HOME', home);
	// A project — and so a project bucket — no other run has used.
	name = `bk-${Date.now().toString(36)}`;
	writeComposeApp(dir, {
		name,
		target: 'compose',
		deployed: ['production', 'staging', 'preview', 'qa'],
		domains: {
			production: 'shop.example.com',
			staging: 'staging.shop.example.com',
			preview: 'preview.shop.example.com',
			qa: 'qa.shop.example.com',
		},
		deployBackups: {
			staging: { cron: '0 */6 * * *', keep: '7d' },
			preview: false,
		},
	});
	({ workspace, manifest, runnables } = await loadComposeApp(dir));
}, 120_000);

beforeEach(() => {
	lines.length = 0;
});

afterAll(async () => {
	const versions = await s3
		.send(new ListObjectVersionsCommand({ Bucket: bucket() }))
		.catch(() => undefined);
	const objects = [
		...(versions?.Versions ?? []),
		...(versions?.DeleteMarkers ?? []),
	].map((v) => ({ Key: v.Key!, VersionId: v.VersionId }));
	if (objects.length > 0) {
		await s3.send(
			new DeleteObjectsCommand({
				Bucket: bucket(),
				Delete: { Objects: objects },
			}),
		);
	}
	await s3.send(new DeleteBucketCommand({ Bucket: bucket() })).catch(() => {});
	for (const stage of ['production', 'staging']) {
		for (const key of await keysOf(user(stage)).catch(() => [])) {
			await iam.send(
				new DeleteAccessKeyCommand({ UserName: user(stage), AccessKeyId: key }),
			);
		}
		await iam
			.send(
				new DeleteUserPolicyCommand({
					UserName: user(stage),
					PolicyName: BACKUPS_POLICY_NAME,
				}),
			)
			.catch(() => {});
		await iam
			.send(new DeleteUserCommand({ UserName: user(stage) }))
			.catch(() => {});
	}
	vi.unstubAllEnvs();
	await cleanupDir(dir);
	await cleanupDir(home);
});

describe("a deployed compose stage's backups", () => {
	it("expires the stage's backups after 30 days, keeping the bucket's own rule and every other stage's", async () => {
		// The bucket as the S3 state store creates it: its own rule alone.
		await ensureProjectBucket(s3, {
			bucket: bucket(),
			region: REGION,
			identity: deployIdentity(workspace, 'production'),
		});

		const reports = await provision('production');
		const backups = reports.find((r) => r.kind === 'backups');
		expect(backups?.actions.map((a) => `${a.resource}: ${a.change}`)).toEqual([
			`bucket ${bucket()}: lifecycle: gkm/${name}/production/backups/ after 30 days, gkm/${name}/qa/backups/ after 30 days, gkm/${name}/staging/backups/ after 7 days`,
			`IAM user ${user('production')}: create under /gkm/`,
			`IAM user ${user('production')}: policy gkm-backups: put objects under gkm/${name}/production/backups/ only`,
			`IAM user ${user('production')}: create an access key`,
		]);

		const lifecycle = async () =>
			(
				await s3.send(
					new GetBucketLifecycleConfigurationCommand({ Bucket: bucket() }),
				)
			).Rules?.map((rule) => ({
				id: rule.ID,
				prefix: rule.Filter?.Prefix ?? rule.Prefix,
				days: rule.Expiration?.Days,
				noncurrent: rule.NoncurrentVersionExpiration?.NoncurrentDays,
			})).sort((a, b) => a.id!.localeCompare(b.id!));
		const expected = [
			{
				id: 'gkm-backups-production',
				prefix: `gkm/${name}/production/backups/`,
				days: 30,
				noncurrent: undefined,
			},
			{
				id: 'gkm-backups-qa',
				prefix: `gkm/${name}/qa/backups/`,
				days: 30,
				noncurrent: undefined,
			},
			{
				id: 'gkm-backups-staging',
				prefix: `gkm/${name}/staging/backups/`,
				days: 7,
				noncurrent: undefined,
			},
			{
				id: 'gkm-noncurrent-versions',
				prefix: '',
				days: undefined,
				noncurrent: NONCURRENT_VERSION_DAYS,
			},
		];
		expect(await lifecycle()).toEqual(expected);

		// Another stage's deploy keeps production's rule, and puts nothing.
		const staging = await provision('staging');
		expect(
			staging
				.find((r) => r.kind === 'backups')
				?.actions.filter((a) => a.resource.startsWith('bucket')),
		).toEqual([]);
		expect(await lifecycle()).toEqual(expected);
	});

	it('gives its key PutObject under its own prefix, and nothing else', async () => {
		const policy = await iam.send(
			new GetUserPolicyCommand({
				UserName: user('production'),
				PolicyName: BACKUPS_POLICY_NAME,
			}),
		);
		const document = JSON.parse(decodeURIComponent(policy.PolicyDocument!));
		expect(document).toEqual(
			backupsPolicy(bucket(), `gkm/${name}/production/backups`),
		);
		expect(document.Statement).toEqual([
			{
				Sid: 'GkmBackupsPut',
				Effect: 'Allow',
				Action: ['s3:PutObject'],
				Resource: `arn:aws:s3:::${bucket()}/gkm/${name}/production/backups/*`,
			},
		]);

		const tags = await iam.send(
			new ListUserTagsCommand({ UserName: user('production') }),
		);
		expect(tags.Tags).toEqual(
			expect.arrayContaining([
				{ Key: 'gkm:stage', Value: 'production' },
				{ Key: 'gkm:construct', Value: 'backups' },
			]),
		);

		// What it may do, it can.
		const { client, address } = await backupsClient('production');
		await client.send(
			new PutObjectCommand({
				Bucket: address.bucket,
				Key: `gkm/${name}/production/backups/2026-10-10/02-00-00Z/database.sql.gz`,
				Body: 'dump',
			}),
		);
	});

	it("writes its key into the stage's secrets as BACKUPS_URL, and the deploy's check puts with it", async () => {
		const secrets = await secretsOf('production');
		const address = s3Url.parse(secrets.BACKUPS_URL!);
		expect(address).toMatchObject({
			bucket: bucket(),
			region: REGION,
			endpoint: LOCALSTACK_URL,
			forcePathStyle: true,
		});
		expect(await keysOf(user('production'))).toEqual([address.accessKeyId]);

		const verified = await verifyStageProviders({
			workspace,
			manifest,
			stage: 'production',
			secrets,
			resources: (await (await stateStore()).read('production'))?.resources,
		});
		expect(verified).toEqual(['backups: s3']);
		const marker = await s3.send(
			new GetObjectCommand({
				Bucket: bucket(),
				Key: `gkm/${name}/production/backups/${VERIFY_MARKER}`,
			}),
		);
		expect(marker.$metadata.httpStatusCode).toBe(200);

		// A second run changes nothing.
		const again = await provision('production');
		expect(again.find((r) => r.kind === 'backups')?.actions).toEqual([]);
	});

	it('rotates its key with --rotate-keys, and retires the old one with --retire-old-keys', async () => {
		const before = s3Url.parse((await secretsOf('production')).BACKUPS_URL!);

		await provision('production', { rotateKeys: true });
		const after = s3Url.parse((await secretsOf('production')).BACKUPS_URL!);
		expect(after.accessKeyId).not.toBe(before.accessKeyId);
		expect(await keysOf(user('production'))).toEqual(
			[before.accessKeyId!, after.accessKeyId!].sort(),
		);

		const previous = useNewKeyWaits([5, 5]);
		try {
			const verified = await verifyStageProviders({
				workspace,
				manifest,
				stage: 'production',
				secrets: await secretsOf('production'),
				resources: (await (await stateStore()).read('production'))?.resources,
			});
			expect(verified).toEqual(['backups: s3']);
		} finally {
			useNewKeyWaits(previous);
		}

		await provision('production', { retireOldKeys: true });
		expect(await keysOf(user('production'))).toEqual([after.accessKeyId]);
	});

	it('plans BACKUPS_URL on a dry run, and creates nothing', async () => {
		const reports = await provision('qa', { dryRun: true });
		expect(reports.find((r) => r.kind === 'backups')).toMatchObject({
			kind: 'backups',
			planned: ['BACKUPS_URL'],
		});
		expect(await keysOf(user('qa')).catch(() => 'no such user')).toBe(
			'no such user',
		);
		expect((await secretsOf('qa')).BACKUPS_URL).toBeUndefined();
	});

	it('takes none on a stage set to false, and says so', async () => {
		const reports = await provision('preview');
		expect(reports.find((r) => r.kind === 'backups')).toBeUndefined();
		expect((await secretsOf('preview')).BACKUPS_URL).toBeUndefined();
		expect(lines.join('\n')).toContain(
			'deploy.backups.preview is false. Nothing is backed up, and nothing already backed up is deleted.',
		);
	});
});
