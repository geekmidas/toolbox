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
	/**
	 * A signed form a browser posts one file to, straight into the bucket.
	 *
	 * The policy is the guard: the storage refuses a file larger than
	 * `maxSize`, or of a type the policy does not allow, so nothing the client
	 * sends past this call is trusted to the server that issued it.
	 *
	 * @param params - What may be uploaded, and where.
	 * @returns The form's action and fields, the key, and when it expires.
	 */
	getUploadPost(params: UploadPostParams): Promise<UploadPost>;
	/**
	 * Delete a file from storage.
	 *
	 * @param key - The key (path) of the file to delete.
	 */
	delete(key: string): Promise<void>;
}

/** What a signed upload form allows. */
export interface UploadPostParams {
	/** Where the object lands. */
	key: string;
	/** The largest file the storage accepts, in bytes. */
	maxSize: number;
	/**
	 * The type the file must be sent as: an exact `Content-Type`, fixed in the
	 * form's fields — or `{ startsWith }`, which the client sets itself
	 * (`image/` for any image). Absent, any type is accepted.
	 */
	contentType?: string | { startsWith: string };
	/** How long the form is valid, in seconds. Defaults to 300. */
	expiresIn?: number;
}

/**
 * A signed upload form. Post it as `multipart/form-data`: every field, then
 * the file last, as `file`.
 */
export interface UploadPost {
	/** The form's action — where the browser posts. */
	url: string;
	/** Every field the post must carry, as signed. */
	fields: Record<string, string>;
	/** Where the object lands. */
	key: string;
	/** When the signature stops being accepted, as an ISO timestamp. */
	expiresAt: string;
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
	/**
	 * Override the Content-Type of the response.
	 * Useful when the stored object's content type differs from what the browser should receive.
	 */
	responseContentType?: string;
	/**
	 * Control how the browser handles the file.
	 * - `'attachment'` — prompts download (default when `name` is set)
	 * - `'inline'` — displays in the browser
	 */
	disposition?: 'inline' | 'attachment';
}
