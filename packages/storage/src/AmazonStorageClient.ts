import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectVersionsCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { Cache } from '@geekmidas/cache';
import type { Attributes } from '@opentelemetry/api';
import {
	type DocumentVersion,
	type File,
	type GetUploadParams,
	type GetUploadResponse,
	type StorageClient,
	StorageProvider,
} from './StorageClient';
import { type StorageOperation, traceStorage } from './telemetry';

export class AmazonStorageClient implements StorageClient {
	readonly provider = StorageProvider.AWSS3;

	static create(
		options: AmazonStorageClientCreateOptions,
	): AmazonStorageClient {
		const {
			bucket,
			region,
			accessKeyId,
			acl,
			endpoint,
			secretAccessKey,
			forcePathStyle = false,
			cache,
		} = options;
		const hasCredentials = accessKeyId && secretAccessKey;
		const credentials = hasCredentials
			? { accessKeyId, secretAccessKey }
			: undefined;

		const client = new S3Client({
			region,
			credentials,
			endpoint,
			forcePathStyle,
		});

		return new AmazonStorageClient(client, bucket, acl, cache);
	}
	constructor(
		private readonly client: S3Client,
		private readonly bucket: string,
		private readonly acl = AmazonCannedAccessControlList.AuthenticatedRead,
		readonly cache?: Cache,
	) {}

	/** A storage span on this bucket. */
	private traced<T>(
		operation: StorageOperation,
		fn: () => Promise<T>,
		attributes: Attributes = {},
	): Promise<T> {
		return traceStorage(
			operation,
			{ 'storage.system': 's3', 'storage.bucket': this.bucket, ...attributes },
			fn,
		);
	}

	private createGetObjectCommand(
		file: File,
		overrides?: { VersionId?: string },
	): GetObjectCommand {
		const disposition =
			file.disposition ?? (file.name ? 'attachment' : undefined);
		const ResponseContentDisposition = disposition
			? file.name
				? `${disposition}; filename=${encodeURIComponent(file.name)}`
				: disposition
			: undefined;

		return new GetObjectCommand({
			Bucket: this.bucket,
			Key: file.path,
			ResponseContentDisposition,
			ResponseContentType: file.responseContentType,
			...overrides,
		});
	}

	getVersionDownloadURL(file: File, versionId: string): Promise<string> {
		const command = this.createGetObjectCommand(file, { VersionId: versionId });
		return this.traced(
			'presign',
			() => getSignedUrl(this.client, command, { expiresIn: 60 * 60 * 24 }),
			{ 'storage.presign.method': 'GET' },
		);
	}

	async getVersions(key: string): Promise<DocumentVersion[]> {
		const command = new ListObjectVersionsCommand({
			Bucket: this.bucket,
			Prefix: key,
		});

		const { Versions = [] } = await this.traced('list', () =>
			this.client.send(command),
		);

		return Versions.map((version) => ({
			id: version.VersionId || '',
			createdAt: version.LastModified || new Date(),
		}));
	}

	async getDownloadURL(file: File, expiresIn = 60 * 60): Promise<string> {
		const cacheKey = `download-url:${file.path}`;
		const cachedURL = await this.cache?.get<string>(cacheKey);

		if (cachedURL) {
			return cachedURL;
		}

		const command = this.createGetObjectCommand(file);
		const url = await this.traced(
			'presign',
			() => getSignedUrl(this.client, command, { expiresIn }),
			{ 'storage.presign.method': 'GET' },
		);
		const cacheExpiration = Math.max(expiresIn - 60, 0);

		if (cacheExpiration) {
			await this.cache?.set(cacheKey, url, cacheExpiration);
		}

		return url;
	}

	async getUploadURL(
		params: GetUploadParams,
		expiresIn = 60 * 60,
	): Promise<string> {
		const command = new PutObjectCommand({
			Bucket: this.bucket,
			Key: params.path,
			ContentType: params.contentType,
			ContentLength: params.contentLength,
		});

		return this.traced(
			'presign',
			() => getSignedUrl(this.client, command, { expiresIn }),
			{ 'storage.presign.method': 'PUT' },
		);
	}

	async getUpload(
		params: GetUploadParams,
		expiresIn = 5,
	): Promise<GetUploadResponse> {
		const { path } = params;
		const { fields: values, url } = await this.traced(
			'presign',
			() =>
				createPresignedPost(this.client, {
					Expires: expiresIn * 60,
					Bucket: this.bucket,
					Fields: {
						acl: this.acl,
					},
					Conditions: [
						// content length restrictions: 0-1MB]
						// ['content-length-range', 0, contentLength],
						// specify content-type to be more generic- images only
						// ['starts-with', '$Content-Type', 'image/'],
						// ['starts-with', '$Content-Type', contentType],
					],
					Key: path,
				}),
			{ 'storage.presign.method': 'POST' },
		);

		const keys = Object.keys(values);
		const fields = keys.map((key) => ({ key, value: values[key] || '' }));

		return { url, fields };
	}

	async upload(
		key: string,
		data: string | Buffer,
		contentType: string,
	): Promise<void> {
		const Body = typeof data === 'string' ? Buffer.from(data, 'base64') : data;

		const params = {
			Bucket: this.bucket,
			Key: key,
			Body,
			ContentType: contentType,
		};

		const command = new PutObjectCommand(params);

		await this.traced('put', () => this.client.send(command), {
			'storage.object.size': Body.length,
			'storage.object.content_type': contentType,
		});
	}

	async delete(key: string): Promise<void> {
		const command = new DeleteObjectCommand({
			Bucket: this.bucket,
			Key: key,
		});

		await this.traced('delete', () => this.client.send(command));
	}
}

export enum AmazonCannedAccessControlList {
	AuthenticatedRead = 'authenticated-read',
	Private = 'private',
	PublicRead = 'public-read',
	PublicReadWrite = 'public-read-write',
	AwsExecRead = 'aws-exec-read',
	BucketOwnerRead = 'bucket-owner-read',
	BucketOwnerFullControl = 'bucket-owner-full-control',
	LogDeliveryWrite = 'log-delivery-write',
}

interface AmazonStorageClientCreateOptions {
	bucket: string;
	region?: string;
	acl?: AmazonCannedAccessControlList;
	accessKeyId?: string;
	secretAccessKey?: string;
	endpoint?: string;
	forcePathStyle?: boolean;
	cache?: Cache;
}
