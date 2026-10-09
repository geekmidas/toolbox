/**
 * A stage's secrets in S3: one object per stage,
 * `<prefix>/<project>/<stage>/secrets.json`, in the project bucket beside the
 * deploy state (`providers/projectBucket.ts`) — or in a bucket the config
 * names, which must exist.
 *
 * Encrypted at rest with SSE-S3, asked for on every write although the
 * project bucket defaults to it, so no KMS key is another place to keep. The
 * bucket's versioning keeps every past document. Unlike an SSM parameter
 * there is no size to outgrow.
 *
 * The project bucket is created by the first write, never by a read: a stage
 * whose bucket or object does not exist yet has no secrets. Every write is
 * conditional — `If-Match` on the ETag this store last read for the stage,
 * `If-None-Match: *` when it read none — so two `secrets:set` runs at once
 * cannot each overwrite the other's key: the second is refused with
 * {@link StageSecretsChanged}.
 */

import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
	type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { STSClient } from '@aws-sdk/client-sts';
import type { DeployIdentity } from '../deploy/identity.js';
import { GkmError } from '../errors';
import {
	callerAccountId,
	ensureProjectBucket,
	findProjectBucket,
	projectBucketName,
} from '../providers/projectBucket.js';
import {
	type AwsStoreOptions,
	awsClientConfig,
	withStageCredentials,
} from './awsStore.js';
import { s3SecretsKey } from './providers.js';
import type { SecretsStore } from './store.js';
import type { StageSecrets } from './types.js';

export interface S3SecretsStoreOptions extends AwsStoreOptions {
	/** The deploy identity: the project bucket's name and its tag. */
	identity: Pick<DeployIdentity, 'scope' | 'key'>;
	/** A bucket that exists; omitted, the project bucket. */
	bucket?: string;
	/** Key prefix inside the bucket, without a trailing slash. */
	prefix: string;
	/** For tests: credentials to use instead of the default chain. */
	credentials?: S3ClientConfig['credentials'];
}

/**
 * Another run wrote the stage's secrets after this one read them. Nothing was
 * written: the change is to be made again, on top of theirs.
 */
export class StageSecretsChanged extends GkmError {
	constructor(
		readonly stage: string,
		/** `s3://<bucket>/<key>` */
		readonly location: string,
	) {
		super(
			`The secrets for stage "${stage}" at ${location} changed after this command read them — ` +
				'another secrets command or deploy wrote them first. Nothing was written; run the command ' +
				'again to make the change on top of theirs.',
		);
		this.name = 'StageSecretsChanged';
	}
}

interface S3Failure {
	name?: string;
	$metadata?: { httpStatusCode?: number };
}

/** A conditional write that lost: the object is not what the write assumed. */
function lostRace(error: unknown): boolean {
	const { name, $metadata } = (error ?? {}) as S3Failure;
	return (
		name === 'PreconditionFailed' ||
		name === 'ConditionalRequestConflict' ||
		$metadata?.httpStatusCode === 412 ||
		$metadata?.httpStatusCode === 409
	);
}

function notFound(error: unknown): boolean {
	const { name, $metadata } = (error ?? {}) as S3Failure;
	return (
		name === 'NoSuchKey' ||
		name === 'NotFound' ||
		$metadata?.httpStatusCode === 404
	);
}

export class S3SecretsStore implements SecretsStore {
	readonly name = 's3';

	private clients?: { s3: S3Client; sts: STSClient };
	/** The bucket's name, once known. */
	private bucketName?: string;
	/** Whether the bucket is known to exist. */
	private exists = false;
	/** The ETag each stage was last read at — null: read, and not there. */
	private readonly etags = new Map<string, string | null>();

	constructor(private readonly options: S3SecretsStoreOptions) {
		if (options.bucket) {
			this.bucketName = options.bucket;
			this.exists = true;
		}
	}

	/** The bucket's name; the project bucket's is known after the first call. */
	get bucket(): string {
		return (
			this.bucketName ??
			projectBucketName(this.options.identity.scope, '<account id>')
		);
	}

	/** Where a stage's secrets are kept: `s3://<bucket>/<key>`. */
	location(stage: string): string {
		return `s3://${this.bucket}/${this.key(stage)}`;
	}

	private key(stage: string): string {
		return s3SecretsKey(this.options.prefix, this.options.project, stage);
	}

	private async client(): Promise<{ s3: S3Client; sts: STSClient }> {
		if (this.clients) return this.clients;
		const base = await awsClientConfig(this.options);
		const endpoint =
			base.endpoint ??
			process.env.AWS_ENDPOINT_URL_S3 ??
			process.env.AWS_ENDPOINT_URL;
		const credentials = this.options.credentials ?? base.credentials;
		this.clients = {
			s3: new S3Client({
				region: base.region,
				...(endpoint ? { endpoint, forcePathStyle: true } : {}),
				...(credentials ? { credentials } : {}),
			}),
			sts: new STSClient({
				region: base.region,
				...(base.endpoint ? { endpoint: base.endpoint } : {}),
				...(credentials ? { credentials } : {}),
			}),
		};
		return this.clients;
	}

	/** One AWS call, a missing or expired credential refused by name. */
	private call<T>(
		stage: string,
		access: 'read' | 'write',
		run: () => Promise<T>,
	): Promise<T> {
		return withStageCredentials(
			{ stage, store: this.name, profile: this.options.profile, access },
			run,
		);
	}

	/**
	 * The bucket, or null for a project bucket that does not exist yet and is
	 * not to be created (a read).
	 */
	private async use(
		stage: string,
		create: boolean,
	): Promise<{ s3: S3Client; bucket: string | null }> {
		const { s3, sts } = await this.client();
		if (this.exists) return { s3, bucket: this.bucketName! };
		const access = create ? 'write' : 'read';
		this.bucketName ??= projectBucketName(
			this.options.identity.scope,
			await this.call(stage, access, () => callerAccountId(sts)),
		);
		const bucket = this.bucketName;
		if (create) {
			await this.call(stage, access, () =>
				ensureProjectBucket(s3, {
					bucket,
					region: this.options.region,
					identity: this.options.identity,
				}),
			);
		} else if (
			(await this.call(stage, access, () => findProjectBucket(s3, bucket))) ===
			'none'
		) {
			return { s3, bucket: null };
		}
		this.exists = true;
		return { s3, bucket };
	}

	/**
	 * @throws {StageSecretsUnreadable} when there are no AWS credentials to
	 * read it with, or they have expired
	 */
	async read(stage: string): Promise<StageSecrets | null> {
		const { s3, bucket } = await this.use(stage, false);
		if (!bucket) {
			this.etags.set(stage, null);
			return null;
		}
		try {
			const response = await this.call(stage, 'read', () =>
				s3.send(new GetObjectCommand({ Bucket: bucket, Key: this.key(stage) })),
			);
			const body = (await response.Body?.transformToString('utf-8')) ?? '';
			this.etags.set(stage, response.ETag ?? null);
			return body ? (JSON.parse(body) as StageSecrets) : null;
		} catch (error) {
			if (!notFound(error)) throw error;
			this.etags.set(stage, null);
			return null;
		}
	}

	/**
	 * Replace the stage's secrets — on the condition that they are still what
	 * this store last read. A stage never read here is replaced as it is now.
	 *
	 * @throws {StageSecretsChanged} when another run wrote them in between
	 * @throws {StageSecretsUnreadable} when there are no AWS credentials to
	 * write it with, or they have expired
	 */
	async write(stage: string, secrets: StageSecrets): Promise<void> {
		const { s3, bucket } = await this.use(stage, true);
		const Bucket = bucket!;
		const Key = this.key(stage);
		const expected = this.etags.has(stage)
			? (this.etags.get(stage) ?? null)
			: await this.currentEtag(s3, stage, Bucket, Key);

		try {
			const { ETag } = await this.call(stage, 'write', () =>
				s3.send(
					new PutObjectCommand({
						Bucket,
						Key,
						Body: JSON.stringify(secrets),
						ContentType: 'application/json',
						ServerSideEncryption: 'AES256',
						...(expected === null
							? { IfNoneMatch: '*' }
							: { IfMatch: expected }),
					}),
				),
			);
			this.etags.set(
				stage,
				ETag ?? (await this.currentEtag(s3, stage, Bucket, Key)),
			);
		} catch (error) {
			if (lostRace(error)) {
				this.etags.delete(stage);
				throw new StageSecretsChanged(stage, `s3://${Bucket}/${Key}`);
			}
			throw error;
		}
	}

	private async currentEtag(
		s3: S3Client,
		stage: string,
		Bucket: string,
		Key: string,
	): Promise<string | null> {
		try {
			const { ETag } = await this.call(stage, 'write', () =>
				s3.send(new HeadObjectCommand({ Bucket, Key })),
			);
			return ETag ?? null;
		} catch (error) {
			if (notFound(error)) return null;
			throw error;
		}
	}
}
