import {
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  type DocumentVersion,
  type File,
  type GetUploadParams,
  type GetUploadResponse,
  type StorageClient,
  StorageProvider,
} from './StorageClient';

export class AmazonStorageClient implements StorageClient {
  readonly provider = StorageProvider.AWSS3;
  static create(
    options: AmazonStorageClientCreateOptions,
  ): AmazonStorageClient {
    const { bucket, region, accessKeyId, acl, endpoint, secretAccessKey } =
      options;
    const hasCredentials = accessKeyId && secretAccessKey;
    const credentials = hasCredentials
      ? { accessKeyId, secretAccessKey }
      : undefined;

    const client = new S3Client({
      region,
      credentials,
      endpoint,
    });

    return new AmazonStorageClient(client, bucket, acl);
  }
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly acl = AmazonCannedAccessControlList.AuthenticatedRead,
  ) {}

  getVersionDownloadURL(file: File, versionId: string): Promise<string> {
    const ResponseContentDisposition = file.name
      ? `attachment; filename=${encodeURIComponent(file.name)}`
      : undefined;

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: file.path,
      ResponseContentDisposition,
      VersionId: versionId,
    });

    return getSignedUrl(this.client, command, { expiresIn: 60 * 60 * 24 });
  }

  async getVersions(key: string): Promise<DocumentVersion[]> {
    const command = new ListObjectVersionsCommand({
      Bucket: this.bucket,
      Prefix: key,
    });

    const { Versions = [] } = await this.client.send(command);

    return Versions.map((version) => ({
      id: version.VersionId || '',
      createdAt: version.LastModified || new Date(),
    }));
  }

  getDownloadURL(file: File, expiresIn = 60 * 60): Promise<string> {
    const ResponseContentDisposition = file.name
      ? `attachment; filename=${encodeURIComponent(file.name)}`
      : undefined;

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: file.path,
      ResponseContentDisposition,
    });

    return getSignedUrl(this.client, command, { expiresIn });
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

    return getSignedUrl(this.client, command, { expiresIn });
  }

  async getUpload(
    params: GetUploadParams,
    expiresIn = 5,
  ): Promise<GetUploadResponse> {
    const { path } = params;
    const { fields: values, url } = await createPresignedPost(this.client, {
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
    });

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

    await this.client.send(command);
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
}
