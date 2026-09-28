import { RestApi } from '@geekmidas/constructs/rest-api';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { createTypedFetcher } from '../fetcher';
import type { InferOpenApi } from '../infer';

const api = new RestApi('Methods', { path: '.', defaultAuthorizer: 'none' });

const health = api
	.get('/health')
	.output(z.object({ ok: z.boolean() }))
	.handle(async () => ({ ok: true }));
const getUser = api
	.get('/users/:id')
	.params(z.object({ id: z.string() }))
	.output(z.object({ id: z.string() }))
	.handle(async ({ params }) => ({ id: params.id }));
const createUser = api
	.post('/users')
	.body(z.object({ name: z.string(), email: z.string() }))
	.output(z.object({ id: z.string() }))
	.handle(async () => ({ id: '1' }));
const search = api
	.get('/search')
	.query(z.object({ q: z.string(), page: z.number().optional() }))
	.output(z.object({ hits: z.array(z.string()) }))
	.handle(async () => ({ hits: [] }));
const list = api
	.get('/users')
	.query(z.object({ page: z.number().optional() }))
	.output(z.object({ users: z.array(z.string()) }))
	.handle(async () => ({ users: [] }));

type Paths = InferOpenApi<
	[typeof health, typeof getUser, typeof createUser, typeof search, typeof list]
>['paths'];

const client = createTypedFetcher<Paths>();

describe('api.<method>(route, config)', () => {
	it('takes no second argument when the endpoint declares nothing', () => {
		expectTypeOf(client.get('/health')).resolves.toEqualTypeOf<{
			ok: boolean;
		}>();
		// @ts-expect-error — GET /health takes no body
		client.get('/health', { body: {} });
	});

	it('requires the argument when there are path params or a body', () => {
		client.get('/users/{id}', { params: { id: '1' } });
		// @ts-expect-error — the params are required
		client.get('/users/{id}');

		client.post('/users', { body: { name: 'Ada', email: 'a@b.c' } });
		// @ts-expect-error — `email` is missing
		client.post('/users', { body: { name: 'Ada' } });
	});

	it('requires a query that has a required key, and not one that has none', () => {
		client.get('/search', { query: { q: 'ada' } });
		// @ts-expect-error — `q` is required, so the argument is too
		client.get('/search');
		// @ts-expect-error — and so is `query` within it
		client.get('/search', {});

		client.get('/users');
		client.get('/users', { query: { page: 2 } });
	});

	it('offers only routes that answer the method', () => {
		// @ts-expect-error — /health has no POST
		client.post('/health');
		// @ts-expect-error — /users/{id} has no POST
		client.post('/users/{id}', { params: { id: '1' } });
	});
});
