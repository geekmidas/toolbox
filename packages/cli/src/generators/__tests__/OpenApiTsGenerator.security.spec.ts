import {
	oauth2ClientCredentials,
	RestApi,
} from '@geekmidas/constructs/rest-api';
import { describe, expect, it } from 'vitest';
import { OpenApiTsGenerator } from '../OpenApiTsGenerator';

const api = new RestApi('SecurityClient', {
	path: '.',
	securitySchemes: {
		session: { type: 'apiKey', in: 'cookie', name: 'session' },
		partners: oauth2ClientCredentials({
			tokenUrl: 'https://auth.example.com/oauth/token',
			scopes: { 'orders:read': 'Read orders' },
		}),
	},
	authorizers: ['session', 'partners'],
	defaultAuthorizer: 'none',
});

/** A `const` the generated module declares, read back as the value it holds. */
function constant(content: string, name: string): unknown {
	const match = content.match(
		new RegExp(`export const ${name} = ([\\s\\S]*?) as const`),
	);
	if (!match) {
		return undefined;
	}
	return new Function(`return (${match[1]});`)();
}

describe('OpenApiTsGenerator — endpoints that accept several authorizers', () => {
	const listOrders = api
		.get('/orders')
		.authorizers(['session', { name: 'partners', scopes: ['orders:read'] }])
		.handle(async () => ({}));
	const me = api
		.get('/me')
		.authorizer('session')
		.handle(async () => ({}));
	const health = api.get('/health').handle(async () => ({}));

	it('collects the scheme of every alternative, not just the first', async () => {
		const content = await new OpenApiTsGenerator().generate([
			listOrders as any,
		]);

		expect(constant(content, 'securitySchemes')).toEqual({
			session: { type: 'apiKey', in: 'cookie', name: 'session' },
			partners: {
				type: 'oauth2',
				flows: {
					clientCredentials: {
						tokenUrl: 'https://auth.example.com/oauth/token',
						scopes: { 'orders:read': 'Read orders' },
					},
				},
			},
		});
		expect(content).toContain(
			"export type SecuritySchemeId = 'session' | 'partners';",
		);
	});

	it('lists every alternative in endpointAuth, and keeps one scheme a string', async () => {
		const content = await new OpenApiTsGenerator().generate([
			listOrders as any,
			me as any,
			health as any,
		]);

		expect(constant(content, 'endpointAuth')).toEqual({
			'GET /orders': ['session', 'partners'],
			'GET /me': 'session',
			'GET /health': null,
		});
		// The fetcher needs a strategy for at least one alternative, not each.
		expect(content).toContain(
			"authStrategies: AuthFetcherOptions<typeof endpointAuth, typeof securitySchemes>['authStrategies'];",
		);
	});
});
