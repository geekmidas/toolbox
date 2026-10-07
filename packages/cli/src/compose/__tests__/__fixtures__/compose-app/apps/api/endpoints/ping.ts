import { z } from 'zod';
import { api } from '../../../constructs/api.js';

/** Logs a line inside its request, so the line and the request share a trace. */
export const ping = api
	.get('/ping')
	.output(z.object({ ok: z.boolean() }))
	.handle(async ({ logger }) => {
		logger.info({ pinged: true }, 'Pinged');
		return { ok: true };
	});
