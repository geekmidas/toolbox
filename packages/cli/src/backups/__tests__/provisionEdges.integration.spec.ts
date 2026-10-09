/**
 * The deploy's backups step at its edges, against the AWS emulator (floci):
 * a project whose bucket is not there yet, a stage that takes none, what it
 * refuses before creating anything, and a key the deploy's check cannot put
 * with.
 */

import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
	CreateAccessKeyCommand,
	CreateUserCommand,
	DeleteAccessKeyCommand,
	DeleteUserCommand,
	DeleteUserPolicyCommand,
	IAMClient,
	ListAccessKeysCommand,
} from '@aws-sdk/client-iam';
import {
	GetBucketLifecycleConfigurationCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import type { ConstructManifest } from '@geekmidas/manifest';
import * as s3Url from '@geekmidas/storage/s3-url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import { deployIdentity } from '../../deploy/identity';
import type { ResourceRecord } from '../../deploy/StateStore';
import type { KeyContext } from '../../providers/iam';
import {
	projectBucketName,
	reconcileProjectBucketLifecycle,
} from '../../providers/projectBucket';
import type { ProvisionAction, StateEntry } from '../../providers/types';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	BACKUPS_POLICY_NAME,
	BackupsCredentialsMissing,
	BackupsKeyRefused,
	BackupsRegionRequired,
	BackupsUserNameTaken,
	backupsRegion,
	backupsUserName,
	ensureStageBackups,
	verifyStageBackups,
} from '../provision';
import { removeBucket } from './__helpers__/bucket';

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
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let name: string;
/** The production stage's secrets, as the first run wrote them. */
const production: Record<string, string> = {};

/** What `ensure()` is handed, kept in memory: state, secrets, and each change. */
function context(stage: string) {
	const records = new Map<string, ResourceRecord>();
	const secrets: Record<string, string> = {};
	const actions: ProvisionAction[] = [];
	const lines: string[] = [];
	const save = (entry: StateEntry, status: 'pending' | 'ready', id?: string) =>
		records.set(entry.key, {
			type: entry.type,
			status,
			...(id ? { id } : {}),
			...(entry.data ? { data: entry.data } : {}),
		} as ResourceRecord);
	const ctx: KeyContext = {
		identity: deployIdentity(workspace, stage),
		stage,
		dryRun: false,
		rotateKeys: false,
		retireOldKeys: false,
		get secrets() {
			return secrets;
		},
		state: {
			record: (key) => records.get(key),
			pending: async (entry) => {
				save(entry, 'pending');
			},
			ready: async (entry, id) => {
				save(entry, 'ready', id);
			},
		},
		async change(action, apply) {
			await apply();
			actions.push(action);
		},
		async writeSecrets(values) {
			Object.assign(secrets, values);
		},
		log: (line) => lines.push(line),
	};
	return { ctx, records, secrets, actions, lines };
}

beforeAll(async () => {
	vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
	vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
	vi.stubEnv('AWS_REGION', REGION);
	vi.stubEnv('AWS_PROFILE', undefined);
	dir = realpathSync(await createTempDir('gkm-backups-edges-'));
	// A project — and so a project bucket — nobody has made yet.
	name = `bkedge-${Date.now().toString(36)}`;
	writeComposeApp(dir, {
		name,
		target: 'compose',
		deployed: ['production', 'preview', 'qa'],
		domains: {
			production: 'shop.example.com',
			preview: 'preview.shop.example.com',
			qa: 'qa.shop.example.com',
		},
		deployBackups: { preview: false },
	});
	({ workspace, manifest } = await loadComposeApp(dir));
}, 120_000);

afterAll(async () => {
	for (const stage of ['production', 'qa']) {
		const user = backupsUserName(deployIdentity(workspace, stage).scope, stage);
		const keys = await iam
			.send(new ListAccessKeysCommand({ UserName: user }))
			.catch(() => undefined);
		for (const key of keys?.AccessKeyMetadata ?? []) {
			await iam.send(
				new DeleteAccessKeyCommand({
					UserName: user,
					AccessKeyId: key.AccessKeyId,
				}),
			);
		}
		await iam
			.send(
				new DeleteUserPolicyCommand({
					UserName: user,
					PolicyName: BACKUPS_POLICY_NAME,
				}),
			)
			.catch(() => {});
		await iam.send(new DeleteUserCommand({ UserName: user })).catch(() => {});
	}
	await removeBucket(
		s3,
		projectBucketName(deployIdentity(workspace, '').scope, ACCOUNT),
	).catch(() => {});
	vi.unstubAllEnvs();
	await cleanupDir(dir);
});

describe('a project with no bucket yet', () => {
	it("creates it with every stage's expiry, then the user and its key", async () => {
		const { ctx, actions, secrets } = context('production');
		const choice = await ensureStageBackups({
			workspace,
			manifest,
			stage: 'production',
			ctx,
		});
		expect(choice.mode).toBe('on');

		const bucket = projectBucketName(
			deployIdentity(workspace, '').scope,
			ACCOUNT,
		);
		expect(actions[0]).toEqual({
			construct: 'backups',
			resource: `bucket ${bucket}`,
			change: `create in ${REGION}, expiring each stage's backups`,
		});
		const rules = await s3.send(
			new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
		);
		expect(rules.Rules?.map((r) => r.ID).sort()).toEqual([
			'gkm-backups-production',
			'gkm-backups-qa',
			'gkm-noncurrent-versions',
		]);
		expect(s3Url.parse(secrets.BACKUPS_URL!).bucket).toBe(bucket);
		Object.assign(production, secrets);

		// The deploy's check puts with it.
		expect(
			await verifyStageBackups({
				workspace,
				manifest,
				stage: 'production',
				secrets,
			}),
		).toBe(true);
	});
});

describe('the backups user and its key, on a later run', () => {
	const ensure = (ctx: KeyContext) =>
		ensureStageBackups({ workspace, manifest, stage: 'production', ctx });

	it("adopts the key the stage's secrets hold when the state has no record of it", async () => {
		const again = context('production');
		Object.assign(again.secrets, production);
		await ensure(again.ctx);
		expect(again.actions).toEqual([]);
		expect(again.records.get('iam-access-key:backups')).toMatchObject({
			status: 'ready',
			id: s3Url.parse(production.BACKUPS_URL!).accessKeyId,
		});
	});

	it("puts the bucket's region back in a URL that names another", async () => {
		const run = context('production');
		Object.assign(run.secrets, production);
		await ensure(run.ctx);
		const address = s3Url.parse(run.secrets.BACKUPS_URL!);
		run.secrets.BACKUPS_URL = s3Url.build({ ...address, region: 'us-east-2' });

		run.actions.length = 0;
		await ensure(run.ctx);
		expect(run.actions.map((a) => a.change)).toEqual([
			`name ${REGION}, the bucket's region (it said us-east-2)`,
		]);
		expect(s3Url.parse(run.secrets.BACKUPS_URL!).region).toBe(REGION);
	});

	it('refuses a BACKUPS_URL set by hand to another bucket, or to no URL at all', async () => {
		for (const url of ['s3://K:S@somebody-elses-bucket', 'not a url']) {
			const run = context('production');
			run.secrets.BACKUPS_URL = url;
			await expect(ensure(run.ctx)).rejects.toMatchObject({
				name: 'BucketKeySetElsewhere',
			});
		}
	});

	it('rotates, refuses a second rotation while the first is live, and retires the old key', async () => {
		const run = context('production');
		Object.assign(run.secrets, production);
		await ensure(run.ctx);
		const before = s3Url.parse(run.secrets.BACKUPS_URL!).accessKeyId;

		const rotate = { ...run.ctx, rotateKeys: true } as KeyContext;
		Object.defineProperty(rotate, 'secrets', { get: () => run.secrets });
		await ensure(rotate);
		const after = s3Url.parse(run.secrets.BACKUPS_URL!).accessKeyId;
		expect(after).not.toBe(before);
		expect(run.lines.join('\n')).toContain(
			`BACKUPS_URL holds the new key. This deploy moves 'production' onto it`,
		);

		await expect(ensure(rotate)).rejects.toMatchObject({
			name: 'RotationInProgress',
		});

		// Not deployed since: the old key is kept, and said so.
		run.lines.length = 0;
		await ensure(run.ctx);
		expect(run.lines.join('\n')).toContain(
			`the old access key ${before} stays active`,
		);

		const retire = { ...run.ctx, retireOldKeys: true } as KeyContext;
		Object.defineProperty(retire, 'secrets', { get: () => run.secrets });
		await ensure(retire);
		const user = backupsUserName(
			deployIdentity(workspace, 'production').scope,
			'production',
		);
		const keys = await iam.send(new ListAccessKeysCommand({ UserName: user }));
		expect(keys.AccessKeyMetadata?.map((k) => k.AccessKeyId)).toContain(after);
		expect(keys.AccessKeyMetadata?.map((k) => k.AccessKeyId)).not.toContain(
			before,
		);
	});

	it("leaves a user that is not this stage's alone, by name", async () => {
		const user = backupsUserName(deployIdentity(workspace, 'qa').scope, 'qa');
		await iam.send(new CreateUserCommand({ UserName: user }));
		await expect(
			ensureStageBackups({
				workspace,
				manifest,
				stage: 'qa',
				ctx: context('qa').ctx,
			}),
		).rejects.toMatchObject({ name: 'IamUserNotOwned', user });
	});

	it('stops at a user with two keys it has no record of', async () => {
		const run = context('production');
		const user = backupsUserName(
			deployIdentity(workspace, 'production').scope,
			'production',
		);
		const listed = await iam.send(
			new ListAccessKeysCommand({ UserName: user }),
		);
		while ((listed.AccessKeyMetadata?.length ?? 0) < 2) {
			const made = await iam.send(
				new CreateAccessKeyCommand({ UserName: user }),
			);
			listed.AccessKeyMetadata = [
				...(listed.AccessKeyMetadata ?? []),
				{ AccessKeyId: made.AccessKey!.AccessKeyId },
			];
		}
		await expect(ensure(run.ctx)).rejects.toMatchObject({
			name: 'AccessKeyLimit',
		});
	});
});

describe('what it does not do', () => {
	it('takes none on a stage set to false, saying so, and none on the local stage', async () => {
		const preview = context('preview');
		expect(
			await ensureStageBackups({
				workspace,
				manifest,
				stage: 'preview',
				ctx: preview.ctx,
			}),
		).toEqual({ mode: 'disabled' });
		expect(preview.lines).toEqual([
			'💾 backups: off — deploy.backups.preview is false. Nothing is backed up, and nothing already backed up is deleted.',
		]);
		expect(preview.actions).toEqual([]);

		const local = context('development');
		expect(
			await ensureStageBackups({
				workspace,
				manifest,
				stage: 'development',
				ctx: local.ctx,
			}),
		).toEqual({ mode: 'none', reason: 'local' });
		expect(local.lines).toEqual([]);
	});

	it('refuses a bucket construct whose user would be the backups user', async () => {
		const clashing = {
			...workspace,
			deploy: {
				...workspace.deploy,
				objects: { production: { provider: 's3', region: REGION } },
			},
		} as NormalizedWorkspace;
		const { ctx } = context('production');
		await expect(
			ensureStageBackups({
				workspace: clashing,
				manifest: {
					...manifest,
					Backups: { kind: 'objects' },
				} as ConstructManifest,
				stage: 'production',
				ctx,
			}),
		).rejects.toBeInstanceOf(BackupsUserNameTaken);
	});

	it('refuses to start with no AWS credentials, before creating anything', async () => {
		const { ctx, actions } = context('production');
		const nowhere = join(dir, 'no-aws');
		// No key, no profile, no files and no instance role for the SDK's chain.
		vi.stubEnv('AWS_ACCESS_KEY_ID', '');
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', '');
		vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', join(nowhere, 'credentials'));
		vi.stubEnv('AWS_CONFIG_FILE', join(nowhere, 'config'));
		vi.stubEnv('AWS_EC2_METADATA_DISABLED', 'true');
		vi.stubEnv('AWS_WEB_IDENTITY_TOKEN_FILE', '');
		vi.stubEnv('AWS_CONTAINER_CREDENTIALS_FULL_URI', '');
		vi.stubEnv('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', '');
		try {
			await expect(
				ensureStageBackups({
					workspace,
					manifest,
					stage: 'production',
					ctx,
					env: { AWS_REGION: REGION },
					home: nowhere,
				}),
			).rejects.toBeInstanceOf(BackupsCredentialsMissing);
		} finally {
			vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
			vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
		}
		expect(actions).toEqual([]);
	});
});

describe('the region the project bucket is in', () => {
	const ws = (parts: Partial<NormalizedWorkspace>) =>
		({ secrets: {}, ...parts }) as NormalizedWorkspace;

	it("is the S3 state's, the secrets store's, the credential's, then AWS_REGION", () => {
		expect(
			backupsRegion(
				ws({ state: { provider: 's3', region: 'ap-south-1' } as never }),
				'production',
				{ region: 'us-west-2' },
				{ AWS_REGION: 'eu-west-1' },
			),
		).toBe('ap-south-1');
		expect(
			backupsRegion(
				ws({
					secrets: {
						store: { provider: 'ssm', region: 'eu-central-1' },
					} as never,
				}),
				'production',
				{ region: 'us-west-2' },
				{},
			),
		).toBe('eu-central-1');
		expect(
			backupsRegion(ws({}), 'production', { region: 'us-west-2' }, {}),
		).toBe('us-west-2');
		expect(
			backupsRegion(
				ws({}),
				'production',
				{},
				{ AWS_DEFAULT_REGION: 'sa-east-1' },
			),
		).toBe('sa-east-1');
	});

	it('is required', () => {
		expect(() => backupsRegion(ws({}), 'production', {}, {})).toThrow(
			BackupsRegionRequired,
		);
	});
});

describe("the deploy's check of the key", () => {
	it('checks nothing where there is no key, or no backups', async () => {
		for (const [stage, secrets] of [
			['production', {}],
			['production', { BACKUPS_URL: 's3://bucket?region=eu-west-1' }],
			['preview', { BACKUPS_URL: 's3://K:S@bucket' }],
		] as const) {
			expect(
				await verifyStageBackups({ workspace, manifest, stage, secrets }),
			).toBe(false);
		}
	});

	it('stops the deploy when the key cannot put, saying what S3 said', async () => {
		const error = await verifyStageBackups({
			workspace,
			manifest,
			stage: 'production',
			secrets: {
				BACKUPS_URL: s3Url.build({
					bucket: `${name}-gone`,
					region: REGION,
					endpoint: LOCALSTACK_URL,
					forcePathStyle: true,
					accessKeyId: 'test',
					secretAccessKey: 'test',
				}),
			},
		}).catch((e) => e);
		expect(error).toBeInstanceOf(BackupsKeyRefused);
		expect(error).toMatchObject({
			bucket: `${name}-gone`,
			key: `gkm/${name}/production/backups/.gkm-verify`,
			said: expect.stringMatching(/^HTTP 404 NoSuchBucket/),
		});
	});

	it("reports what S3 said when the bucket's lifecycle cannot be read", async () => {
		await expect(
			reconcileProjectBucketLifecycle(s3, `${name}-not-a-bucket`, []),
		).rejects.toMatchObject({ name: 'NoSuchBucket' });
	});
});
