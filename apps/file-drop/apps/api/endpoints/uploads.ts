import { randomUUID } from 'node:crypto';
import { api } from '@file-drop/constructs/api.js';
import { drop } from '@file-drop/constructs/storage.js';
import { z } from 'zod';

/** Anyone may upload, so keep it to small images. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * A presigned PUT for a new public object, and the CDN address it will be
 * served from. The key is random, so nobody overwrites anybody else's file.
 */
export const createUpload = api
	.post('/uploads')
	.dependsOn([drop])
	.body(
		z.object({
			name: z.string().min(1).max(200),
			contentType: z.enum([
				'image/png',
				'image/jpeg',
				'image/gif',
				'image/webp',
			]),
			contentLength: z.number().int().positive().max(MAX_BYTES),
		}),
	)
	.output(z.object({ uploadUrl: z.string(), url: z.string() }))
	.handle(async ({ body, services }) => {
		const safe = body.name.replace(/[^a-zA-Z0-9._-]/g, '_');
		const key = `public/${randomUUID()}-${safe}` as const;
		const uploadUrl = await services.drop.getUploadURL(
			{
				path: key,
				contentType: body.contentType,
				contentLength: body.contentLength,
			},
			300,
		);
		return { uploadUrl, url: services.drop.url(key) };
	});
