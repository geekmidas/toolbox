import { RestApi } from '@geekmidas/constructs/rest-api';
import { describe, it } from 'vitest';
import { z } from 'zod';
import { createTypedFetcher } from '../fetcher';
import type { InferOpenApi } from '../infer';
import type { paths } from '../openapi-types';

const api = new RestApi('OptionalBody', {
	path: '.',
	defaultAuthorizer: 'none',
});

const touch = api
	.post('/touch')
	.body(z.object({ note: z.string() }).optional())
	.output(z.object({ ok: z.boolean() }))
	.handle(async () => ({ ok: true }));
const create = api
	.post('/things')
	.body(z.object({ name: z.string() }))
	.output(z.object({ id: z.string() }))
	.handle(async () => ({ id: '1' }));

type Paths = InferOpenApi<[typeof touch, typeof create]>['paths'];

describe('an optional request body', () => {
	it('may be left out, and is still typed when sent', () => {
		const client = createTypedFetcher<Paths>();
		client.post('/touch');
		client('POST /touch', {});
		client('POST /touch', { body: { note: 'hi' } });
		// @ts-expect-error — `note` is a string
		client('POST /touch', { body: { note: 1 } });
	});

	it('leaves a required body required', () => {
		const client = createTypedFetcher<Paths>();
		// @ts-expect-error — the body is required
		client.post('/things');
		// @ts-expect-error — the body is required
		client('POST /things', {});
	});

	it('is optional in a generated `paths` whose `requestBody` key is', () => {
		type Generated = {
			'/touch': {
				post: {
					requestBody?: {
						content: { 'application/json': { note: string } };
					};
					responses: {
						200: { content: { 'application/json': { ok: boolean } } };
					};
				};
			};
		} & paths;
		const client = createTypedFetcher<Generated>();
		client.post('/touch');
		client('POST /touch', {});
		client('POST /touch', { body: { note: 'hi' } });
	});
});
