import { z } from 'zod';
import { api } from '../../../constructs/api.js';

/**
 * Three lines, written 700ms apart — not server-sent events, which a proxy
 * may recognise and flush on its own, but a plain chunked body, as a
 * streamed render is. Through an edge that buffers, they arrive together.
 */
export const stream = api
	.get('/stream')
	.responseType('text/plain')
	.output(z.instanceof(ReadableStream))
	.handle(async () => {
		const encoder = new TextEncoder();
		return new ReadableStream<Uint8Array>({
			async start(controller) {
				for (let i = 1; i <= 3; i++) {
					controller.enqueue(encoder.encode(`chunk ${i}\n`));
					if (i < 3) await new Promise((resolve) => setTimeout(resolve, 700));
				}
				controller.close();
			},
		});
	});
