import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';
import logger from '../config/logger.js';
import { StorageService } from '../services/StorageService.js';

/**
 * A presigned S3 upload URL — demonstrates the storage service. Uses its own
 * lean factory (only the storage service) to show endpoints don't have to share
 * the big router. `STORAGE_*` env is sniffed into the manifest via StorageService.
 */
export const createUploadUrl = e
	.logger(logger)
	.services([StorageService])
	.post('/uploads')
	.body(
		z.object({
			path: z.string().min(1),
			contentType: z.string().default('application/octet-stream'),
			contentLength: z.number().int().positive(),
		}),
	)
	.output(z.object({ url: z.string() }))
	.handle(async ({ body, services }) => {
		const url = await services.storage.getUploadURL(
			{
				path: body.path,
				contentType: body.contentType,
				contentLength: body.contentLength,
			},
			3600,
		);
		return { url };
	});
