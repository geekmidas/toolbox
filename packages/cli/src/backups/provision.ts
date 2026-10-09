/**
 * What a deploy creates for a stage's backups, in its AWS account — before
 * its checks, beside the stage's providers, with the same credentials:
 *
 * - **the project bucket**, if it is not there yet, and its lifecycle — the
 *   bucket's own rule and an expiry on every stage's `backups/` prefix,
 *   rebuilt from every stage's `deploy.backups` each time, so one stage's
 *   deploy never drops another's rule;
 * - **an IAM user**, `gkm-<project>-<stage>-backups` under `/gkm/`, whose
 *   inline policy allows `s3:PutObject` under the stage's backups prefix and
 *   nothing else — no get, no list, no delete: a server that is broken into
 *   can neither read the backups nor wipe them;
 * - **its key**, written into the stage's secrets as `BACKUPS_URL`, rotated
 *   by `--rotate-keys` and retired by `--retire-old-keys` like a bucket's.
 *
 * Every deploy's check puts a marker object with the key — the one thing it
 * may do — so a key that does not work stops the deploy, not the 02:00 run.
 */

import type { ConstructManifest } from '@geekmidas/manifest';
import type { ResourceRecord } from '../deploy/StateStore.js';
import { GkmError } from '../errors';
import {
	type AwsProvisioning,
	awsClientConfig,
	awsEndpoint,
	awsProvisioningCredentials,
} from '../providers/aws.js';
import { stageProvider } from '../providers/config.js';
import {
	ensureAccessKey,
	ensureIamUser,
	issuedJustNow,
	type KeyContext,
	whileKeyIsNew,
} from '../providers/iam.js';
import {
	callerAccountId,
	ensureProjectBucket,
	findProjectBucket,
	projectBucketName,
	reconcileProjectBucketLifecycle,
} from '../providers/projectBucket.js';
import { S3_PROVISIONING } from '../providers/s3/config.js';
import { iamUserName } from '../providers/s3/naming.js';
import { appKey } from '../workspace/derive.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import {
	backupExpiries,
	backupsPrefix,
	type StageBackupsChoice,
	stageBackups,
} from './config.js';
import { BACKUPS_SERVICE, BACKUPS_URL_KEY } from './service.js';

/** What the backups user and its key are recorded and tagged as. */
export const BACKUPS_ID = 'backups';

/** The backups user's inline policy's name. */
export const BACKUPS_POLICY_NAME = 'gkm-backups';

/** Where a deploy's check puts its marker, under the backups prefix. */
export const VERIFY_MARKER = '.gkm-verify';

/** The backups user's name: `gkm-<project>-<stage>-backups`. */
export function backupsUserName(scope: string, stage: string): string {
	return iamUserName({ scope, stage, id: BACKUPS_ID });
}

/**
 * The backups key's policy: put objects under the stage's backups prefix.
 * Uploading in parts is `s3:PutObject` too; aborting one is not, and the
 * bucket's lifecycle does it instead.
 */
export function backupsPolicy(bucket: string, prefix: string) {
	return {
		Version: '2012-10-17' as const,
		Statement: [
			{
				Sid: 'GkmBackupsPut',
				Effect: 'Allow' as const,
				Action: ['s3:PutObject'],
				Resource: `arn:aws:s3:::${bucket}/${prefix}/*`,
			},
		],
	};
}

/** A stage that backs up, and no AWS credentials to create its key with. */
export class BackupsCredentialsMissing extends GkmError {
	constructor(readonly stage: string) {
		super(
			`'${stage}' runs Postgres, so the deploy backs it up — and creates the ` +
				"IAM user and key it backs up with in the stage's AWS account — and " +
				`it found no AWS credentials to do it with. On this machine, supply ` +
				`${S3_PROVISIONING.describe}. In CI, the step that runs the deploy ` +
				"needs the stage's role (AWS_ROLE_ARN, " +
				`from gkm deploy:github). To take no backups, set deploy.backups.${stage}: false.`,
		);
		this.name = 'BackupsCredentialsMissing';
	}
}

/** No region to create the project bucket in. */
export class BackupsRegionRequired extends GkmError {
	constructor(readonly stage: string) {
		super(
			`'${stage}' is backed up to the project bucket, and there is no region ` +
				"to find it in: set state: { provider: 's3', region } in gkm.config.ts, " +
				'or AWS_REGION.',
		);
		this.name = 'BackupsRegionRequired';
	}
}

/** A bucket construct whose IAM user would be the backups user. */
export class BackupsUserNameTaken extends GkmError {
	constructor(
		readonly stage: string,
		readonly construct: string,
	) {
		super(
			`The bucket '${construct}' is reached on '${stage}' with the IAM user ` +
				"the stage's backups are put with — both are named after 'backups'. " +
				`Rename the construct, or set deploy.backups.${stage}: false.`,
		);
		this.name = 'BackupsUserNameTaken';
	}
}

/** The backups key could not put its marker: backups would fail too. */
export class BackupsKeyRefused extends GkmError {
	constructor(
		readonly stage: string,
		readonly bucket: string,
		readonly key: string,
		readonly said: string,
	) {
		super(
			`The ${BACKUPS_URL_KEY} key of '${stage}' could not put s3://${bucket}/${key} ` +
				`(${said}), so its backups would fail the same way. Run the deploy ` +
				"with the stage's AWS credentials to put its user and policy back, or " +
				'--rotate-keys to issue it a new key.',
		);
		this.name = 'BackupsKeyRefused';
	}
}

/**
 * The region the project bucket is in: the state's, when it is kept in S3,
 * the secrets store's when that is in AWS, the credential's, `AWS_REGION`.
 */
export function backupsRegion(
	workspace: Pick<NormalizedWorkspace, 'state' | 'secrets'>,
	stage: string,
	credential?: { region?: string },
	env: NodeJS.ProcessEnv = process.env,
): string {
	const state = workspace.state;
	const store = workspace.secrets?.store;
	const region =
		(state && 'region' in state ? (state.region as string) : undefined) ??
		(store && typeof store === 'object' && 'region' in store
			? (store as { region?: string }).region
			: undefined) ??
		credential?.region ??
		env.AWS_REGION ??
		env.AWS_DEFAULT_REGION;
	if (!region) throw new BackupsRegionRequired(stage);
	return region;
}

export interface EnsureBackupsInput {
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	stage: string;
	/** Everything creating the user and key reads — the providers' own. */
	ctx: KeyContext;
	profile?: string;
	home?: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * The stage's backups bucket, lifecycle, user and key — or, for a stage set
 * to `false`, a notice and nothing else. Returns what the stage's backups
 * came to.
 *
 * @throws {BackupsCredentialsMissing} when there are no AWS credentials
 */
export async function ensureStageBackups(
	input: EnsureBackupsInput,
): Promise<StageBackupsChoice> {
	const { workspace, manifest, stage, ctx } = input;
	const env = input.env ?? process.env;
	const choice = stageBackups(workspace, manifest, stage);
	if (choice.mode === 'disabled') {
		ctx.log(
			`💾 backups: off — deploy.backups.${stage} is false. Nothing is backed up, and nothing already backed up is deleted.`,
		);
		return choice;
	}
	if (choice.mode !== 'on') return choice;

	const objects = stageProvider(workspace, 'objects', stage);
	if (objects.mode === 'provider') {
		const clash = Object.entries(manifest).find(
			([id, d]) => d.kind === 'objects' && appKey(id) === BACKUPS_ID,
		);
		if (clash) throw new BackupsUserNameTaken(stage, clash[0]);
	}

	const credential = await awsProvisioningCredentials({
		stage,
		env,
		...(input.profile ? { profile: input.profile } : {}),
		...(input.home ? { home: input.home } : {}),
	});
	if (!credential) throw new BackupsCredentialsMissing(stage);

	const region = backupsRegion(workspace, stage, credential, env);
	const clients = await backupsClients(credential, region, env);
	const bucket = projectBucketName(
		ctx.identity.scope,
		await callerAccountId(clients.sts),
	);
	const prefix = backupsPrefix(workspace, stage);
	const expiries = backupExpiries(workspace, manifest);

	ctx.log(
		`💾 backups: ${choice.backups.describe}, to s3://${bucket}/${prefix}/${ctx.dryRun ? ' (dry run)' : ''}`,
	);

	// The bucket, and every stage's expiry on it.
	if ((await findProjectBucket(clients.s3, bucket)) === 'none') {
		await ctx.change(
			{
				construct: BACKUPS_SERVICE,
				resource: `bucket ${bucket}`,
				change: `create in ${region}, expiring each stage's backups`,
			},
			async () => {
				await ensureProjectBucket(clients.s3, {
					bucket,
					region,
					identity: ctx.identity,
					expiries,
				});
			},
		);
	} else if (
		await reconcileProjectBucketLifecycle(clients.s3, bucket, expiries, {
			dryRun: true,
		})
	) {
		await ctx.change(
			{
				construct: BACKUPS_SERVICE,
				resource: `bucket ${bucket}`,
				change: `lifecycle: ${expiries.map((e) => `${e.prefix} after ${e.days} days`).join(', ')}`,
			},
			async () => {
				await reconcileProjectBucketLifecycle(clients.s3, bucket, expiries);
			},
		);
	}

	const user = await ensureIamUser(ctx, clients, {
		id: BACKUPS_ID,
		user: backupsUserName(ctx.identity.scope, stage),
		policyName: BACKUPS_POLICY_NAME,
		policy: backupsPolicy(bucket, prefix),
		describe: `put objects under ${prefix}/ only`,
	});
	await ensureAccessKey(ctx, clients, {
		id: BACKUPS_ID,
		bucket,
		urlKey: BACKUPS_URL_KEY,
		...user,
	});
	return choice;
}

/** The clients a backups run creates through. */
async function backupsClients(
	credential: AwsProvisioning,
	region: string,
	env: NodeJS.ProcessEnv,
) {
	const S3 = await import('@aws-sdk/client-s3');
	const IAM = await import('@aws-sdk/client-iam');
	const { STSClient } = await import('@aws-sdk/client-sts');
	const config = await awsClientConfig(credential, region);
	const endpoint = awsEndpoint(env, 'S3');
	return {
		IAM,
		iam: new IAM.IAMClient(config),
		s3: new S3.S3Client({
			...config,
			...(endpoint ? { endpoint, forcePathStyle: true } : {}),
		}),
		sts: new STSClient(config),
		region,
		...(endpoint ? { endpoint } : {}),
	};
}

export interface VerifyBackupsInput {
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	stage: string;
	secrets: Readonly<Record<string, string>>;
	resources?: Readonly<Record<string, ResourceRecord>>;
	log?: (line: string) => void;
}

/**
 * The stage's backups key puts its marker under the prefix — the one thing
 * it may do. A key issued by this deploy is waited for, as a bucket's is.
 * Returns whether there was a key to check.
 *
 * @throws {BackupsKeyRefused}
 */
export async function verifyStageBackups(
	input: VerifyBackupsInput,
): Promise<boolean> {
	const { stage } = input;
	if (stageBackups(input.workspace, input.manifest, stage).mode !== 'on') {
		return false;
	}
	const url = input.secrets[BACKUPS_URL_KEY];
	if (!url) return false;
	const s3Url = await import('@geekmidas/storage/s3-url');
	const address = s3Url.parse(url);
	if (!address.accessKeyId || !address.secretAccessKey) return false;

	const S3 = await import('@aws-sdk/client-s3');
	const client = new S3.S3Client({
		region: address.region ?? 'us-east-1',
		credentials: {
			accessKeyId: address.accessKeyId,
			secretAccessKey: address.secretAccessKey,
		},
		...(address.endpoint ? { endpoint: address.endpoint } : {}),
		...(address.forcePathStyle ? { forcePathStyle: true } : {}),
	});
	const Key = `${backupsPrefix(input.workspace, stage)}/${VERIFY_MARKER}`;
	const put = async (): Promise<{
		ok: boolean;
		status?: number;
		said: string;
	}> => {
		try {
			await client.send(
				new S3.PutObjectCommand({
					Bucket: address.bucket,
					Key,
					Body: new Date().toISOString(),
					ContentType: 'text/plain',
				}),
			);
			return { ok: true, said: '' };
		} catch (error) {
			const e = error as {
				name?: string;
				message?: string;
				$metadata?: { httpStatusCode?: number };
			};
			const status = e.$metadata?.httpStatusCode;
			return {
				ok: false,
				...(status !== undefined ? { status } : {}),
				said: `HTTP ${status ?? 'no response'} ${e.name ?? 'Error'}: ${e.message ?? ''}`,
			};
		}
	};
	try {
		const { answer } = await whileKeyIsNew(await put(), {
			issuedAt: issuedJustNow(input.resources, BACKUPS_ID, address.accessKeyId),
			refused: (answer) => !answer.ok && answer.status === 403,
			ask: put,
			onWait: () =>
				input.log?.(
					`   backups: waiting for the new key ${address.accessKeyId} to become active…`,
				),
		});
		if (!answer.ok) {
			throw new BackupsKeyRefused(stage, address.bucket, Key, answer.said);
		}
		return true;
	} finally {
		client.destroy();
	}
}
