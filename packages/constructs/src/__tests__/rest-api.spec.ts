import type { Service } from '@geekmidas/services';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { sniffService } from '../Construct';
import { TestEndpointAdaptor } from '../endpoints/TestEndpointAdaptor';
import { RestApi } from '../rest-api';

const api = () =>
	new RestApi('Api', { path: 'apps/api', defaultAuthorizer: 'none' });

/** Stands in for an auth server — anything that declares a surface. */
const authServer = {
	id: 'Auth',
	declare: () => [
		{ kind: 'rest-api' as const, id: 'Auth', path: 'apps/auth', endpoints: [] },
	],
};

describe('RestApi', () => {
	it.each([
		['patch', 'PATCH'],
		['delete', 'DELETE'],
		['options', 'OPTIONS'],
	] as const)('builds a %s endpoint on the surface', (verb, method) => {
		const endpoint = api()
			[verb]('/orders/:id')
			.handle(async () => ({}));

		expect(endpoint.method).toBe(method);
		expect(endpoint.route).toBe('/orders/:id');
		// Built from the surface, so the build knows which app serves it.
		expect(endpoint.surface?.id).toBe('Api');
	});

	it('branches from the surface itself, and hands the branch `db`', async () => {
		interface Db {
			users: () => string[];
		}
		const database: Service<'appDb', Db> = {
			serviceName: 'appDb',
			register: () => ({ users: () => [] }),
		};
		const surface = api();

		// No factory to reach through first: the surface is where endpoints are
		// built, whether one at a time or as a group sharing a database.
		const router = surface.database(database);
		const listUsers = router
			.get('/users')
			.output(z.object({ users: z.array(z.string()) }))
			.handle(async ({ db }) => ({ users: db.users() }));

		expect(listUsers.surface?.id).toBe('Api');
		const result = await new TestEndpointAdaptor(listUsers).request({
			services: {},
			headers: {},
			database: { users: () => ['ada'] },
		});
		expect(result).toEqual({ users: ['ada'] });

		// A branch is a new factory: a route built straight from the surface is
		// not handed the database because some group of routes asked for it.
		const health = surface.get('/health').handle(async () => ({}));
		expect(health.databaseService).toBeUndefined();
	});

	it('lets one endpoint name its own database over the branch’s', () => {
		interface Reports {
			totals: () => number;
		}
		const appDb: Service<'appDb', { users: () => string[] }> = {
			serviceName: 'appDb',
			register: () => ({ users: () => [] }),
		};
		const reportsDb: Service<'reportsDb', Reports> = {
			serviceName: 'reportsDb',
			register: () => ({ totals: () => 0 }),
		};
		const router = api().database(appDb);

		const report = router
			.get('/reports')
			.database(reportsDb)
			.handle(async ({ db }) => {
				expectTypeOf(db).toEqualTypeOf<Reports>();
				return {};
			});
		const users = router.get('/users').handle(async () => ({}));

		expect(report.databaseService?.serviceName).toBe('reportsDb');
		// The override is the endpoint's alone; the branch keeps its own.
		expect(users.databaseService?.serviceName).toBe('appDb');
	});

	it('names its authenticator, as an edge and as the auth it declares', () => {
		const base = api();
		const authed = base.auth(authServer);

		expect(authed.declare()[0]).toMatchObject({
			auth: 'Auth',
			calls: [{ target: 'Auth', kind: 'rest-api' }],
		});
		// Immutable: the surface it was built from has neither.
		expect(base.declare()[0]).not.toHaveProperty('auth');
		expect(base.declare()[0]).not.toHaveProperty('calls');
	});

	it('declares its CORS tunables and that it streams into a Telescope', () => {
		const declared = new RestApi('Api', {
			path: 'apps/api',
			defaultAuthorizer: 'none',
			cors: { maxAge: 600, credentials: true },
			telescope: {} as never,
		}).declare()[0];

		expect(declared).toMatchObject({
			telescope: true,
			cors: { maxAge: 600, credentials: true },
		});
	});
});

describe('sniffService', () => {
	it('lets a service log and read its context while being sniffed', async () => {
		// Registration runs without a request; a service that logs or reads the
		// request id while it sets up must still be sniffable.
		const chatty: Service<'chatty', object> = {
			serviceName: 'chatty',
			async register({ envParser, context }) {
				const logger = context.getLogger().child({ service: 'chatty' });
				logger.info({ requestId: context.getRequestId() }, 'registering');
				logger.debug({ at: context.getRequestStartTime() }, 'started');
				logger.warn({ live: context.hasContext() }, 'no request');
				logger.error('nothing is wrong');
				return envParser
					.create((get) => ({ url: get('CHATTY_URL').string() }))
					.parse();
			},
		};

		const result = await sniffService(chatty);

		expect(result.envVars).toEqual(['CHATTY_URL']);
		expect(result.error).toBeUndefined();
	});
});
