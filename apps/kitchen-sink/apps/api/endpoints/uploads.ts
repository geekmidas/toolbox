import { api } from '@kitchen-sink/constructs/api.js';
import { uploads } from '@kitchen-sink/constructs/storage.js';
import { z } from 'zod';

/**
 * A presigned upload URL. Built from the surface directly rather than the
 * router — only the bucket — to show that an endpoint need not share the big
 * router's database, auditor and publisher.
 *
 * `.dependsOn([uploads])` is the whole of the wiring: the construct
 * declares the bucket, the target injects `UPLOADS_URL`, and the scheme in that
 * URL builds the client. Nothing here names MinIO, S3, a region, or a key.
 */
export const createUploadUrl = api
	.post('/uploads')
	.dependsOn([uploads])
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
