import { NotFoundError } from '@geekmidas/errors';
import { z } from 'zod';
import { api } from '../../../constructs/api.js';
import { sessions } from '../../../constructs/cache.js';

/** Puts a value in the cache. */
export const putCached = api
	.put('/cache/:key')
	.dependsOn([sessions])
	.params(z.object({ key: z.string() }))
	.body(z.object({ value: z.string() }))
	.output(z.object({ stored: z.boolean() }))
	.handle(async ({ params, body, services }) => {
		await services.sessions.set(`fixture:${params.key}`, body.value, 300);
		return { stored: true };
	});

/** Reads a value back out of the cache. */
export const getCached = api
	.get('/cache/:key')
	.dependsOn([sessions])
	.params(z.object({ key: z.string() }))
	.output(z.object({ value: z.string() }))
	.handle(async ({ params, services }) => {
		const value = await services.sessions.get<string>(`fixture:${params.key}`);
		if (value === undefined) throw new NotFoundError('Not cached');
		return { value };
	});
