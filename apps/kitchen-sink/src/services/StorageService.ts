import { InMemoryCache } from '@geekmidas/cache/memory';
import type { Service } from '@geekmidas/services';
import type { StorageClient } from '@geekmidas/storage';
import { AmazonStorageClient } from '@geekmidas/storage/aws';

/**
 * S3-backed storage (`@geekmidas/storage`). Produces presigned upload/download
 * URLs. The `STORAGE_*` vars are sniffed into the manifest via `.create((get) => …)`.
 * Point `STORAGE_ENDPOINT` at LocalStack/MinIO for local dev; the dummy creds let
 * presigned URLs be signed offline. A `Cache` is passed to show storage+cache
 * composition. `ServiceDiscovery` caches the resolved client.
 */
export const StorageService = {
	serviceName: 'storage' as const,
	register({ envParser }) {
		const config = envParser
			.create((get) => ({
				bucket: get('STORAGE_BUCKET').string(),
				region: get('STORAGE_REGION').string().default('us-east-1'),
				accessKeyId: get('STORAGE_ACCESS_KEY_ID').string().default('local'),
				secretAccessKey: get('STORAGE_SECRET_ACCESS_KEY')
					.string()
					.default('local'),
				endpoint: get('STORAGE_ENDPOINT').string().optional(),
				forcePathStyle: get('STORAGE_FORCE_PATH_STYLE')
					.string()
					.transform((v) => v === 'true')
					.default(false),
			}))
			.parse();

		const client: StorageClient = AmazonStorageClient.create({
			bucket: config.bucket,
			region: config.region,
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
			endpoint: config.endpoint,
			forcePathStyle: config.forcePathStyle,
			cache: new InMemoryCache(),
		});
		return client;
	},
} satisfies Service<'storage', StorageClient>;
