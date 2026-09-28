import type { Service } from '@geekmidas/services';
import { describe, expect, it } from 'vitest';
import { sniffService } from '../Construct';
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
