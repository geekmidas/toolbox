/**
 * Amazon S3 state store.
 *
 * In the bucket the config names, which must exist — or, with none named, in
 * the project bucket (`providers/projectBucket.ts`): found by its name, which
 * is worked out from the project and the account, and created by the first
 * write (a deploy's lock, `state:push`). A read of a project bucket that does
 * not exist yet is a stage with no state; it creates nothing.
 *
 * - `<prefix>/<workspace>/<stage>/state.json`: the state.
 * - `<prefix>/<workspace>/<stage>/lock.json`: the lock.
 * - `<prefix>/<workspace>/<stage>/state.v1.json`: the v1 state, kept on
 *   migration.
 *
 * Every write is conditional on the server: `If-None-Match: *` to create,
 * `If-Match: <etag>` to replace. S3 answers a lost race with 412 (or 409 when
 * two conditional writes are in flight at once), so there is no window
 * between a check and a write for another run to slip into.
 */

import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
	type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { STSClient } from '@aws-sdk/client-sts';
import {
	callerAccountId,
	ensureProjectBucket,
	findProjectBucket,
	projectBucketName,
} from '../providers/projectBucket';
import { type DeployIdentity, deployIdentity } from './identity';
import type { AwsRegion } from './StateProvider';
import {
	DocumentStateStore,
	type LockHolder,
	type RawState,
	StateLocked,
	type StateVersion,
	StateVersionConflict,
} from './StateStore';

export interface S3StateStoreOptions {
	workspaceName: string;
	/** Omitted, the project bucket — created by the first write. */
	bucket?: string;
	/** `deploy.namespace`, for the project bucket's name. */
	namespace?: string;
	/** Key prefix inside the bucket; `gkm` by default. */
	prefix?: string;
	region?: AwsRegion;
	/** Uses the default credential chain when omitted. */
	profile?: string;
	credentials?: S3ClientConfig['credentials'];
	/** For the local AWS emulator. */
	endpoint?: string;
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

/** The project bucket, for a store that names no bucket of its own. */
export interface ProjectBucketSource {
	identity: Pick<DeployIdentity, 'scope' | 'key'>;
	region: string;
	/** What the account id — and so the bucket's name — is read with. */
	sts: STSClient;
}

export class S3StateStore extends DocumentStateStore {
	private readonly prefix: string;
	/** The bucket's name, once known. */
	private name?: string;
	/** Whether the bucket is known to exist. */
	private exists = false;

	constructor(
		readonly workspaceName: string,
		private readonly source: string | ProjectBucketSource,
		private readonly client: S3Client,
		prefix = 'gkm',
	) {
		super();
		this.prefix = prefix.replace(/\/+$/, '');
		if (typeof source === 'string') {
			this.name = source;
			this.exists = true;
		}
	}

	/** The bucket's name; a project bucket's is known after the first call. */
	get bucket(): string {
		if (this.name) return this.name;
		const { identity } = this.source as ProjectBucketSource;
		return projectBucketName(identity.scope, '<account id>');
	}

	/**
	 * The bucket, or `null` for a project bucket that does not exist yet and
	 * is not to be created (`create: false`, a read).
	 */
	private async use(create: boolean): Promise<string | null> {
		if (this.exists) return this.name!;
		const source = this.source as ProjectBucketSource;
		this.name ??= projectBucketName(
			source.identity.scope,
			await callerAccountId(source.sts),
		);
		if (create) {
			await ensureProjectBucket(this.client, {
				bucket: this.name,
				region: source.region,
				identity: source.identity,
			});
		} else if ((await findProjectBucket(this.client, this.name)) === 'none') {
			return null;
		}
		this.exists = true;
		return this.name;
	}

	static create(options: S3StateStoreOptions): S3StateStore {
		const endpoint =
			options.endpoint ??
			process.env.AWS_ENDPOINT_URL_S3 ??
			process.env.AWS_ENDPOINT_URL;
		const config: S3ClientConfig = {
			region: options.region,
			endpoint,
			// The emulator serves buckets by path, not by subdomain.
			forcePathStyle: endpoint ? true : undefined,
		};
		if (options.profile) {
			// Required lazily: only a profile needs the credential providers.
			const { fromIni } = require('@aws-sdk/credential-providers');
			config.credentials = fromIni({ profile: options.profile });
		} else if (options.credentials) {
			config.credentials = options.credentials;
		}
		let source: string | ProjectBucketSource;
		if (options.bucket) {
			source = options.bucket;
		} else {
			source = {
				identity: deployIdentity(
					{
						name: options.workspaceName,
						...(options.namespace
							? { deploy: { namespace: options.namespace } }
							: {}),
					},
					'',
				),
				region: options.region ?? process.env.AWS_REGION ?? 'us-east-1',
				sts: new STSClient({
					region: config.region,
					...(options.endpoint ? { endpoint: options.endpoint } : {}),
					...(config.credentials ? { credentials: config.credentials } : {}),
				}),
			};
		}
		return new S3StateStore(
			options.workspaceName,
			source,
			new S3Client(config),
			options.prefix,
		);
	}

	private key(stage: string, leaf: string): string {
		const path = `${this.workspaceName}/${stage}/${leaf}`;
		return this.prefix ? `${this.prefix}/${path}` : path;
	}

	protected location(stage: string): string {
		return `s3://${this.bucket}/${this.key(stage, 'state.json')}`;
	}

	protected async readRaw(stage: string): Promise<RawState | null> {
		if (!(await this.use(false))) return null;
		const object = await this.get(this.key(stage, 'state.json'));
		if (!object) return null;
		return { body: object.body, version: object.etag };
	}

	protected async writeRaw(
		stage: string,
		body: string,
		expectedVersion: StateVersion | null,
	): Promise<StateVersion> {
		await this.use(true);
		const Key = this.key(stage, 'state.json');
		try {
			const { ETag } = await this.client.send(
				new PutObjectCommand({
					Bucket: this.bucket,
					Key,
					Body: body,
					ContentType: 'application/json',
					...(expectedVersion === null
						? { IfNoneMatch: '*' }
						: { IfMatch: expectedVersion }),
				}),
			);
			if (ETag) return ETag;
			// Some S3-compatible servers omit the ETag on a conditional put.
			return (await this.get(Key))?.etag ?? '';
		} catch (error) {
			if (lostRace(error)) {
				const current = await this.get(Key);
				throw new StateVersionConflict(
					stage,
					expectedVersion,
					current?.etag ?? null,
				);
			}
			throw error;
		}
	}

	protected async writeV1Backup(stage: string, body: string): Promise<void> {
		await this.use(true);
		try {
			await this.client.send(
				new PutObjectCommand({
					Bucket: this.bucket,
					Key: this.key(stage, 'state.v1.json'),
					Body: body,
					ContentType: 'application/json',
					IfNoneMatch: '*',
				}),
			);
		} catch (error) {
			// The first migration's backup is the one worth keeping.
			if (!lostRace(error)) throw error;
		}
	}

	protected async createLock(stage: string, holder: LockHolder): Promise<void> {
		await this.use(true);
		const Key = this.key(stage, 'lock.json');
		try {
			await this.client.send(
				new PutObjectCommand({
					Bucket: this.bucket,
					Key,
					Body: JSON.stringify(holder),
					ContentType: 'application/json',
					IfNoneMatch: '*',
				}),
			);
		} catch (error) {
			if (lostRace(error)) {
				throw new StateLocked(
					stage,
					await this.readLock(stage),
					`s3://${this.bucket}/${Key}`,
				);
			}
			throw error;
		}
	}

	protected async readLock(stage: string): Promise<LockHolder | null> {
		if (!(await this.use(false))) return null;
		const object = await this.get(this.key(stage, 'lock.json'));
		if (!object) return null;
		try {
			return JSON.parse(object.body) as LockHolder;
		} catch {
			return null;
		}
	}

	protected async removeLock(
		stage: string,
		holder: LockHolder | null,
	): Promise<void> {
		if (!(await this.use(false))) return;
		const Key = this.key(stage, 'lock.json');
		const object = await this.get(Key);
		if (!object) return;
		if (holder) {
			try {
				if ((JSON.parse(object.body) as LockHolder).id !== holder.id) return;
			} catch {
				return;
			}
		}
		try {
			// Conditional on the lock read above, so a lock taken by another
			// run in the meantime survives.
			await this.client.send(
				new DeleteObjectCommand({
					Bucket: this.bucket,
					Key,
					IfMatch: object.etag,
				}),
			);
		} catch (error) {
			if (!lostRace(error) && !notFound(error)) throw error;
		}
	}

	private async get(
		Key: string,
	): Promise<{ body: string; etag: string } | null> {
		try {
			const response = await this.client.send(
				new GetObjectCommand({ Bucket: this.bucket, Key }),
			);
			const body = (await response.Body?.transformToString('utf-8')) ?? '';
			return { body, etag: response.ETag ?? '' };
		} catch (error) {
			if (notFound(error)) return null;
			throw error;
		}
	}
}
