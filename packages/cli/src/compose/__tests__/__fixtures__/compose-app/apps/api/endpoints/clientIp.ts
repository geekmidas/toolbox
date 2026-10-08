import { z } from 'zod';
import { api } from '../../../constructs/api.js';

/**
 * The `x-gkm-client-ip` this request reached the API with — none, from
 * outside: the edge strips gkm's own header from everything it forwards.
 */
export const clientIp = api
	.get('/client-ip')
	.output(z.object({ clientIp: z.string().nullable() }))
	.handle(async ({ header }) => ({
		clientIp: header('x-gkm-client-ip') ?? null,
	}));
