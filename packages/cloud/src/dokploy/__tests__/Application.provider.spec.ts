import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { applicationProvider as provider } from '../Application';

/**
 * The provider against Dokploy's tRPC API, served by MSW: what each lifecycle
 * call sends, and how it reads what comes back — including "already gone".
 */

const endpoint = 'https://dokploy.test';
const inputs = {
	endpoint,
	apiToken: 'token-1',
	name: 'My API',
	projectId: 'proj-1',
	environmentId: 'env-1',
};
/** What state holds once the application exists: every later call gets it. */
const outs = { ...inputs, applicationId: 'app-1', appName: 'my-api' };

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Records the one request a call makes, and answers it. */
function answer(
	method: 'get' | 'post',
	path: string,
	respond: () => Response,
): { request: () => Promise<{ body: unknown; headers: Headers }> } {
	let seen: Request | undefined;
	server.use(
		http[method](`${endpoint}/api/trpc/${path}`, ({ request }) => {
			seen = request.clone();
			return respond();
		}),
	);
	return {
		request: async () => ({
			body: seen && method === 'post' ? await seen.json() : undefined,
			headers: seen!.headers,
		}),
	};
}

describe('Dokploy application provider', () => {
	it('creates the application under the name Dokploy derives', async () => {
		const call = answer('post', 'application.create', () =>
			HttpResponse.json({ applicationId: 'app-1', appName: 'my-api' }),
		);

		const result = await provider.create!(inputs);

		const { body, headers } = await call.request();
		expect(headers.get('x-api-key')).toBe('token-1');
		expect(body).toEqual({
			name: 'My API',
			projectId: 'proj-1',
			environmentId: 'env-1',
			appName: 'my-api',
		});
		// Pulumi's id is Dokploy's, so state and the Dokploy UI name the same thing.
		expect(result).toEqual({
			id: 'app-1',
			outs: { ...inputs, applicationId: 'app-1', appName: 'my-api' },
		});
	});

	it('refreshes from the server, and reports one deleted by hand as gone', async () => {
		answer('get', 'application.one', () =>
			HttpResponse.json({ applicationId: 'app-1', appName: 'my-api-2' }),
		);
		expect(await provider.read!('app-1', outs)).toEqual({
			id: 'app-1',
			props: { ...inputs, applicationId: 'app-1', appName: 'my-api-2' },
		});

		server.resetHandlers();
		answer('get', 'application.one', () => HttpResponse.json(null));
		expect(await provider.read!('app-1', outs)).toEqual({ id: undefined });
	});

	it('diffs through the same rule preview uses', async () => {
		expect(
			await provider.diff!('app-1', outs, { ...inputs, name: 'Gateway' }),
		).toMatchObject({ changes: true, replaces: ['name'] });
	});

	it('renames in place, and reports the app name that follows', async () => {
		const call = answer('post', 'application.update', () =>
			HttpResponse.json({}),
		);

		const result = await provider.update!('app-1', outs, {
			...inputs,
			name: 'My Api',
		});

		expect((await call.request()).body).toEqual({
			applicationId: 'app-1',
			name: 'My Api',
		});
		expect(result).toEqual({
			outs: {
				...inputs,
				name: 'My Api',
				applicationId: 'app-1',
				appName: 'my-api',
			},
		});
	});

	it('treats an application that is already gone as deleted', async () => {
		const call = answer('post', 'application.remove', () =>
			HttpResponse.text('no such application', {
				status: 404,
				statusText: 'Not Found',
			}),
		);

		await expect(provider.delete!('app-1', outs)).resolves.toBeUndefined();
		expect((await call.request()).body).toEqual({ applicationId: 'app-1' });
	});

	it('fails a delete, or any call, that Dokploy refused for another reason', async () => {
		answer('post', 'application.remove', () =>
			HttpResponse.text('database is locked', {
				status: 500,
				statusText: 'Internal Server Error',
			}),
		);
		await expect(provider.delete!('app-1', outs)).rejects.toThrow(
			'Dokploy application.remove failed: 500 Internal Server Error — database is locked',
		);

		server.resetHandlers();
		answer(
			'post',
			'application.create',
			() => new HttpResponse(null, { status: 401, statusText: 'Unauthorized' }),
		);
		await expect(provider.create!(inputs)).rejects.toThrow(
			'Dokploy application.create failed: 401 Unauthorized',
		);
	});
});
