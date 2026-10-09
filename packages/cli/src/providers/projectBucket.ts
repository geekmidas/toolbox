/**
 * The project bucket: one S3 bucket per project and AWS account, created and
 * owned by gkm, that holds what gkm keeps for every stage — the deploy state
 * under `<prefix>/<project>/<stage>/`, and anything else gkm writes per stage
 * beside it.
 *
 * Nothing can record its name — the deploy state lives in it — so the name is
 * worked out the same way every time: `gkm-<scope>-<account id>`, the scope
 * being the one the `s3` objects provider names its buckets with. The account
 * id keeps it from clashing with another account's project of the same name
 * without a random suffix; a clash that happens anyway (HeadBucket 403) is
 * refused, never adopted.
 *
 * Created with versioning, SSE-S3, every public access blocked, ownership
 * enforced for the bucket owner, a lifecycle that expires old versions, and
 * the tag `gkm:project=<identity key>`.
 */

import { createHash } from 'node:crypto';
import type {
	BucketLocationConstraint,
	LifecycleRule,
	S3Client,
} from '@aws-sdk/client-s3';
import type { STSClient } from '@aws-sdk/client-sts';
import { type DeployIdentity, deployIdentity } from '../deploy/identity.js';
import { GkmError } from '../errors';

/** S3's limit on a bucket name. */
const BUCKET_NAME_MAX = 63;
/** What the project part may take: 63 less `gkm-`, `-` and a 12-digit id. */
const SCOPE_MAX = BUCKET_NAME_MAX - 'gkm-'.length - 1 - 12;

/** The tag the bucket is created with, as the `s3` provider tags its own. */
export const PROJECT_BUCKET_TAG = 'gkm:project';

/** How long a replaced or deleted object's old version is kept. */
export const NONCURRENT_VERSION_DAYS = 90;

/** The bucket's name is held by another account, or cannot be reached. */
export class ProjectBucketTaken extends GkmError {
	constructor(
		readonly bucket: string,
		/** HeadBucket's status: 403 another account's, 301 another region's. */
		readonly status: number,
	) {
		const why =
			status === 301
				? 'is in another region than the one configured'
				: 'exists and this account cannot reach it — another account holds the name';
		super(
			`The project bucket '${bucket}' ${why} (HTTP ${status}). Name a bucket ` +
				"you own instead — in gkm.config.ts: state: { provider: 's3', " +
				"bucket: '<your bucket>', region: '<its region>' } — or run with the " +
				'credentials of the account the name is for.',
		);
		this.name = 'ProjectBucketTaken';
	}
}

/** The running credentials may not create the project bucket. */
export class ProjectBucketNotCreatable extends GkmError {
	constructor(
		readonly bucket: string,
		readonly reason: string,
	) {
		super(
			`The project bucket '${bucket}' does not exist yet, and these ` +
				`credentials cannot create it (${reason}). Run the first deploy with ` +
				'credentials allowed s3:CreateBucket and the bucket put-config ' +
				'actions on it — `gkm deploy:github` grants them to the CI role — ' +
				"or name an existing bucket: state: { provider: 's3', bucket, region }.",
		);
		this.name = 'ProjectBucketNotCreatable';
	}
}

/**
 * The project bucket's name: `gkm-<scope>-<account id>`, lowercase and
 * DNS-safe. A scope too long to fit keeps its start and ends in a hash of
 * the whole, so two long scopes never share a name.
 */
export function projectBucket(
	workspace: { name: string; deploy?: { namespace?: string } },
	options: { accountId: string },
): string {
	const { scope } = deployIdentity(workspace, '');
	return projectBucketName(scope, options.accountId);
}

/** {@link projectBucket}, from a deploy identity's scope. */
export function projectBucketName(scope: string, accountId: string): string {
	let part = scope
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (part.length > SCOPE_MAX) {
		const hash = createHash('sha256').update(scope).digest('hex').slice(0, 6);
		part = `${part.slice(0, SCOPE_MAX - 7).replace(/-+$/, '')}-${hash}`;
	}
	return `gkm-${part}-${accountId}`;
}

/** The account the credentials are in — what the bucket is named by. */
export async function callerAccountId(sts: STSClient): Promise<string> {
	const { GetCallerIdentityCommand } = await import('@aws-sdk/client-sts');
	const { Account } = await sts.send(new GetCallerIdentityCommand({}));
	return Account ?? '';
}

/** An expiry for one stage's prefix, added beside the bucket's own rule. */
export interface PrefixExpiry {
	/** Rule id, unique in the bucket — e.g. `backups-production`. */
	id: string;
	/** Key prefix it applies to — e.g. `gkm/acme/production/backups/`. */
	prefix: string;
	/** Days after which a current object expires. */
	days: number;
	/**
	 * Days after which a multipart upload under the prefix that never
	 * completed is aborted — its parts are stored, and billed, until it is.
	 */
	abortIncompleteDays?: number;
}

/**
 * The bucket's whole lifecycle configuration. A put replaces every rule the
 * bucket has, so this is the one place the set is built: the bucket's own
 * noncurrent-version expiry, and any per-prefix expiry passed in.
 */
export function projectBucketLifecycle(
	expiries: readonly PrefixExpiry[] = [],
): LifecycleRule[] {
	return [
		{
			ID: 'gkm-noncurrent-versions',
			Status: 'Enabled',
			Filter: { Prefix: '' },
			NoncurrentVersionExpiration: { NoncurrentDays: NONCURRENT_VERSION_DAYS },
			// A lock is deleted every run; its markers go once nothing is under them.
			Expiration: { ExpiredObjectDeleteMarker: true },
		},
		...expiries.map(
			(expiry): LifecycleRule => ({
				ID: expiry.id,
				Status: 'Enabled',
				Filter: { Prefix: expiry.prefix },
				Expiration: { Days: expiry.days },
				...(expiry.abortIncompleteDays
					? {
							AbortIncompleteMultipartUpload: {
								DaysAfterInitiation: expiry.abortIncompleteDays,
							},
						}
					: {}),
			}),
		),
	];
}

/** A lifecycle rule reduced to what gkm sets, for comparing with what is there. */
function canonicalRule(rule: LifecycleRule): string {
	return JSON.stringify({
		id: rule.ID ?? '',
		status: rule.Status ?? '',
		prefix: rule.Filter?.Prefix ?? rule.Prefix ?? '',
		days: rule.Expiration?.Days ?? null,
		markers: rule.Expiration?.ExpiredObjectDeleteMarker ?? null,
		noncurrent: rule.NoncurrentVersionExpiration?.NoncurrentDays ?? null,
		abort: rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation ?? null,
	});
}

/** Whether two rule sets say the same thing, in any order. */
export function sameLifecycle(
	a: readonly LifecycleRule[],
	b: readonly LifecycleRule[],
): boolean {
	const canonical = (rules: readonly LifecycleRule[]) =>
		rules.map(canonicalRule).sort().join('\n');
	return canonical(a) === canonical(b);
}

/**
 * The project bucket's lifecycle put to {@link projectBucketLifecycle} of
 * `expiries` — every stage's — when what it holds says anything else.
 * Returns whether it was put; with `dryRun`, whether it would be.
 */
export async function reconcileProjectBucketLifecycle(
	s3: S3Client,
	bucket: string,
	expiries: readonly PrefixExpiry[],
	options: { dryRun?: boolean } = {},
): Promise<boolean> {
	const S3 = await import('@aws-sdk/client-s3');
	const rules = projectBucketLifecycle(expiries);
	let current: LifecycleRule[] = [];
	try {
		const out = await s3.send(
			new S3.GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
		);
		current = out.Rules ?? [];
	} catch (error) {
		const failure = error as S3Failure;
		const code = failure.Code ?? failure.name;
		if (code !== 'NoSuchLifecycleConfiguration') throw error;
	}
	if (sameLifecycle(current, rules)) return false;
	if (!options.dryRun) {
		await s3.send(
			new S3.PutBucketLifecycleConfigurationCommand({
				Bucket: bucket,
				LifecycleConfiguration: { Rules: rules },
			}),
		);
	}
	return true;
}

interface S3Failure {
	name?: string;
	Code?: string;
	message?: string;
	$metadata?: { httpStatusCode?: number };
}

/**
 * Whether `bucket` is this account's (`ours`) or does not exist (`none`).
 * Mapped by status: a HEAD has no body, so SDK v3 names a 301, 400 or 403
 * `Unknown`.
 *
 * @throws {ProjectBucketTaken} on a 403 or 301
 */
export async function findProjectBucket(
	s3: S3Client,
	bucket: string,
): Promise<'ours' | 'none'> {
	const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
	try {
		await s3.send(new HeadBucketCommand({ Bucket: bucket }));
		return 'ours';
	} catch (error) {
		const status = (error as S3Failure).$metadata?.httpStatusCode;
		if (status === 404) return 'none';
		if (status === 403 || status === 301) {
			throw new ProjectBucketTaken(bucket, status);
		}
		throw error;
	}
}

export interface EnsureProjectBucketOptions {
	bucket: string;
	region: string;
	/** The deploy identity the bucket is tagged with. */
	identity: Pick<DeployIdentity, 'key'>;
	/** Per-prefix expiries beside the bucket's own rule. */
	expiries?: readonly PrefixExpiry[];
}

/**
 * The project bucket, created and configured if it does not exist yet.
 * Returns whether this call created it. One that exists is used as it is.
 *
 * @throws {ProjectBucketTaken} when another account holds the name
 * @throws {ProjectBucketNotCreatable} when the credentials may not create it
 */
export async function ensureProjectBucket(
	s3: S3Client,
	options: EnsureProjectBucketOptions,
): Promise<{ created: boolean }> {
	const { bucket: Bucket, region } = options;
	if ((await findProjectBucket(s3, Bucket)) === 'ours') {
		return { created: false };
	}

	const S3 = await import('@aws-sdk/client-s3');
	try {
		await s3.send(
			new S3.CreateBucketCommand({
				Bucket,
				ObjectOwnership: 'BucketOwnerEnforced',
				// us-east-1 is the one region named by leaving it out.
				...(region === 'us-east-1'
					? {}
					: {
							CreateBucketConfiguration: {
								LocationConstraint: region as BucketLocationConstraint,
							},
						}),
			}),
		);
	} catch (error) {
		const failure = error as S3Failure;
		const code = failure.Code ?? failure.name;
		// Another run created it a moment ago: configure it all the same.
		if (code !== 'BucketAlreadyOwnedByYou') {
			if (code === 'BucketAlreadyExists') {
				throw new ProjectBucketTaken(Bucket, 409);
			}
			if (
				code === 'AccessDenied' ||
				failure.$metadata?.httpStatusCode === 403
			) {
				throw new ProjectBucketNotCreatable(
					Bucket,
					failure.message ?? 'AccessDenied',
				);
			}
			throw error;
		}
	}

	await s3.send(
		new S3.PutPublicAccessBlockCommand({
			Bucket,
			PublicAccessBlockConfiguration: {
				BlockPublicAcls: true,
				IgnorePublicAcls: true,
				BlockPublicPolicy: true,
				RestrictPublicBuckets: true,
			},
		}),
	);
	await s3.send(
		new S3.PutBucketOwnershipControlsCommand({
			Bucket,
			OwnershipControls: {
				Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }],
			},
		}),
	);
	await s3.send(
		new S3.PutBucketEncryptionCommand({
			Bucket,
			ServerSideEncryptionConfiguration: {
				Rules: [
					{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
				],
			},
		}),
	);
	await s3.send(
		new S3.PutBucketVersioningCommand({
			Bucket,
			VersioningConfiguration: { Status: 'Enabled' },
		}),
	);
	await s3.send(
		new S3.PutBucketLifecycleConfigurationCommand({
			Bucket,
			LifecycleConfiguration: {
				Rules: projectBucketLifecycle(options.expiries),
			},
		}),
	);
	await s3.send(
		new S3.PutBucketTaggingCommand({
			Bucket,
			Tagging: {
				TagSet: [{ Key: PROJECT_BUCKET_TAG, Value: options.identity.key }],
			},
		}),
	);
	return { created: true };
}

/**
 * The IAM actions creating and configuring the project bucket takes — what a
 * role that runs the first deploy needs on it, beside object access.
 */
export const PROJECT_BUCKET_CREATE_ACTIONS = [
	's3:CreateBucket',
	's3:PutBucketVersioning',
	's3:PutEncryptionConfiguration',
	's3:PutBucketPublicAccessBlock',
	's3:PutBucketOwnershipControls',
	's3:PutLifecycleConfiguration',
	's3:PutBucketTagging',
] as const;

/**
 * What keeping the project bucket's lifecycle takes on a bucket that exists:
 * reading it, to put it back only when it drifted.
 */
export const PROJECT_BUCKET_LIFECYCLE_ACTIONS = [
	's3:GetLifecycleConfiguration',
	's3:PutLifecycleConfiguration',
] as const;
