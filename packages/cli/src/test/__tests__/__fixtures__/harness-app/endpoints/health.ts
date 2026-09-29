import { z } from 'zod';
import { api } from '../constructs/api.js';

export const health = api
	.get('/health')
	.output(z.object({ ok: z.boolean() }))
	.handle(async () => ({ ok: true }));
