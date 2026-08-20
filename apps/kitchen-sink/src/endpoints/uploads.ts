import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';
import logger from '../config/logger.js';
import { uploads } from '../constructs/storage.js';

/**
 * A presigned upload URL. Uses its own lean factory — only the bucket — to show
 * that an endpoint need not share the big router.
 *
 * `.services([uploads.service])` is the whole of the wiring: the construct
 * declares the bucket, the target injects `UPLOADS_URL`, and the scheme in that
 * URL builds the client. Nothing here names MinIO, S3, a region, or a key.
 */
export const createUploadUrl = e
	.logger(logger)
	.services([uploads.service])
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
		const url = await services.uploads.getUploadURL(
			{
				path: body.path,
				contentType: body.contentType,
				contentLength: body.contentLength,
			},
			3600,
		);
		return { url };
	});
