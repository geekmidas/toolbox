import { describe, expect, it } from 'vitest';
import { createTypedFetcher } from '../fetcher';
import type { paths } from '../openapi-types';
import './setup';

/**
 * `api.get('/users')` is `api('GET /users')` with the method as a call — the
 * same request, the same response, the same typing rules.
 */
describe('method calls', () => {
	// Per test: the fetcher takes `fetch` when it is created, and MSW patches it
	// in `beforeAll`.
	const client = () =>
		createTypedFetcher<paths>({ baseURL: 'https://api.example.com' });

	it('gets a route that takes nothing, with no second argument', async () => {
		const api = client();
		expect(await api.get('/users')).toEqual(await api('GET /users'));
	});

	it('fills path params', async () => {
		const api = client();
		expect(await api.get('/users/{id}', { params: { id: '123' } })).toEqual({
			id: '123',
			name: 'John Doe',
			email: 'john@example.com',
		});
	});

	it('sends a body', async () => {
		const api = client();
		const body = { name: 'Jane Doe', email: 'jane@example.com' };
		expect(await api.post('/users', { body })).toEqual({ id: '123', ...body });
	});

	it('sends params and a body together', async () => {
		const api = client();
		expect(
			await api.put('/users/{id}', {
				params: { id: '456' },
				body: { name: 'Updated Name' },
			}),
		).toMatchObject({ id: '456', name: 'Updated Name' });
	});

	it('sends a query', async () => {
		const api = client();
		const result = await api.get('/posts', { query: { page: 2, limit: 5 } });
		expect(result.pagination).toEqual({ page: 2, limit: 5, total: 50 });
		expect(result.posts).toHaveLength(5);
	});
});
