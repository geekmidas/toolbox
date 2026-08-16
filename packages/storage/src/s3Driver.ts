/**
 * The S3 driver — `s3://` URLs to an {@link AmazonStorageClient}.
 *
 * Registered by whoever assembles the application, so neutral code can build a
 * client from a URL without importing this file or the AWS SDK behind it.
 */

import { AmazonStorageClient } from './AmazonStorageClient';
import type { StorageDriver } from './registry';
import { parse } from './s3Url';

export const s3Driver: StorageDriver = {
	scheme: 's3:',
	create(url) {
		const { bucket, region, endpoint, forcePathStyle } = parse(url);
		return AmazonStorageClient.create({
			bucket,
			region,
			endpoint,
			forcePathStyle,
		});
	},
};
