import type { Cache } from '@geekmidas/cache';
export interface DocumentVersion {
	id: string;
	createdAt: Date;
}

export enum StorageProvider {
	AWSS3 = 'geekimdas.toolbox.storage.aws.s3',
	GCP = 'geekimdas.toolbox.storage.gcp',
	AZURE = 'geekimdas.toolbox.storage.azure',
}

export interface StorageClient {
	readonly provider: StorageProvider;
	readonly cache?: Cache;
	/**
	 * Get a URL to upload a file to.
	 *
	 * @param params - The parameters to get the upload URL for.
	 * @param expiresIn - The number of minutes the URL should be valid for.
	 * Defaults to 60 * 60 (1 hour).
	 * @returns A promise that resolves to the upload URL.
	 */
	getUploadURL(params: GetUploadParams, expiresIn?: number): Promise<string>;

	/**
	 * Get a URL to download a file from.
	 *
	 * @param file - The file to get the download URL for.
	 * @param expiresIn - The number of seconds the URL should be valid for.
	 * Defaults to 60 * 60 (1 hour).
	 * @returns A promise that resolves to the download URL.
	 */
	getDownloadURL(file: File, expiresIn?: number): Promise<string>;
	/**
	 * Get the versions for a key.
	 *
	 * @param key - The key to get the versions for.
	 */
	getVersions(key: string): Promise<DocumentVersion[]>;

	/**
	 * Get a URL to download a version of a file from.
	 *
	 * @param file - The file to get the download URL for.
	 * @param versionId - The version ID to get the download URL for.
	 */
	getVersionDownloadURL(file: File, versionId: string): Promise<string>;
	/**
	 *
	 * @param key - The key to upload the file to.
	 * @param data - The data to upload.
	 * @param contentType - The content type of the data.
	 */
	upload(
		key: string,
		data: string | Buffer,
		contentType: string,
	): Promise<void>;
	/**
	 * Get a URL to upload a file to.
	 *
	 * @param params - The parameters to get the upload URL for.
	 * @param expiresIn - The number of minutes the URL should be valid for.
	 */
	getUpload(
		params: GetUploadParams,
		expiresIn?: number,
	): Promise<GetUploadResponse>;
}

export interface GetUploadParams {
	path: string;
	contentType: string;
	contentLength: number;
}

export type UploadField = {
	key: string;
	value: string;
};

export type GetUploadResponse = {
	url: string;
	fields: UploadField[];
};

export interface File {
	name?: string;
	path: string;
}
