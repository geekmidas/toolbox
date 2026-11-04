import { drop } from '@file-drop/constructs/storage.js';
import sharp from 'sharp';
import { z } from 'zod';

/**
 * A resized WebP of any open image, made when it is first read:
 * `/i/256/public/<key>`. The widths are the allowlist — any other is a 400,
 * so nobody can mint new work by varying the number. A result never changes
 * for a width and a key, so it is kept in the bucket and cached forever.
 */
export const resize = drop
	.process('/i/:width/*')
	.params(z.object({ width: z.enum(['256', '512', '1024']) }))
	.native(['sharp'])
	.handle(async ({ params, object }) => ({
		body: await sharp(await object.bytes())
			.resize({ width: Number(params.width), withoutEnlargement: true })
			.webp()
			.toBuffer(),
		contentType: 'image/webp',
		cache: 'immutable',
	}));
