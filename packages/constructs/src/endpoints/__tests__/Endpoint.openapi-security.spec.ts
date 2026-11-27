import { describe, expect, it } from 'vitest';
import { RestApi } from '../../rest-api';
import {
	AuthorizerNotAvailable,
	NoAuthorizersGiven,
	oauth2AuthorizationCode,
	oauth2ClientCredentials,
} from '../Authorizer';
import { Endpoint } from '../Endpoint';

/**
 * Who may call an endpoint, as the document says it: every authorizer it
 * accepts as an alternative, each with the scopes it must grant.
 */
const partners = oauth2ClientCredentials({
	tokenUrl: 'https://auth.example.com/oauth/token',
	scopes: {
		'orders:read': 'Read orders',
		'orders:write': 'Create and change orders',
	},
});

const api = new RestApi('SecurityDocs', {
	path: '.',
	securitySchemes: {
		session: { type: 'apiKey', in: 'cookie', name: 'session' },
		partners,
		app: oauth2AuthorizationCode({
			authorizationUrl: 'https://auth.example.com/oauth/authorize',
			tokenUrl: 'https://auth.example.com/oauth/token',
			scopes: { profile: 'Read your profile' },
		}),
	},
	authorizers: ['session', 'partners', 'app', 'iam'],
	defaultAuthorizer: 'none',
});

describe('security in the OpenAPI document', () => {
	it('documents both authorizers of an endpoint that accepts either, with its scope', async () => {
		const listOrders = api
			.get('/orders')
			.authorizers(['session', { name: 'partners', scopes: ['orders:read'] }])
			.handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([listOrders]);

		// Two requirement objects: either one is enough.
		expect((doc.paths['/orders'] as any).get.security).toEqual([
			{ session: [] },
			{ partners: ['orders:read'] },
		]);
		expect(doc.components?.securitySchemes).toEqual({
			session: { type: 'apiKey', in: 'cookie', name: 'session' },
			partners: {
				type: 'oauth2',
				flows: {
					clientCredentials: {
						tokenUrl: 'https://auth.example.com/oauth/token',
						scopes: {
							'orders:read': 'Read orders',
							'orders:write': 'Create and change orders',
						},
					},
				},
			},
		});
	});

	it('keeps the first alternative as the authorizer a gateway enforces', () => {
		const listOrders = api
			.get('/orders')
			.authorizers(['session', { name: 'partners', scopes: ['orders:read'] }])
			.handle(async () => ({}));

		expect(listOrders.authorizer?.name).toBe('session');
		expect(
			listOrders.security.map((s) => [s.authorizer.name, s.scopes]),
		).toEqual([
			['session', []],
			['partners', ['orders:read']],
		]);
	});

	it("puts an endpoint's required scopes in its security requirement", async () => {
		const createOrder = api
			.post('/orders')
			.authorizer('partners', { scopes: ['orders:write'] })
			.handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([createOrder]);

		expect((doc.paths['/orders'] as any).post.security).toEqual([
			{ partners: ['orders:write'] },
		]);
		expect(createOrder.authorizer?.name).toBe('partners');
	});

	it("gives a branch's default scopes to the endpoints built from it, unless one names its own", async () => {
		const partnerApi = api.authorizer('partners', {
			scopes: ['orders:read'],
		});
		const read = partnerApi.get('/reports').handle(async () => ({}));
		const write = partnerApi
			.post('/reports')
			.authorizer('partners', { scopes: ['orders:write'] })
			.handle(async () => ({}));
		const open = partnerApi
			.get('/health')
			.authorizer('none')
			.handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([read, write, open]);

		expect((doc.paths['/reports'] as any).get.security).toEqual([
			{ partners: ['orders:read'] },
		]);
		expect((doc.paths['/reports'] as any).post.security).toEqual([
			{ partners: ['orders:write'] },
		]);
		expect((doc.paths['/health'] as any).get).not.toHaveProperty('security');
		expect(open.authorizer).toBeUndefined();
		expect(open.security).toEqual([]);
	});

	it('writes an authorization-code scheme with PKCE as x-usePkce', async () => {
		const me = api
			.get('/me')
			.authorizer('app', { scopes: ['profile'] })
			.handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([me]);

		expect((doc.components?.securitySchemes as any).app).toEqual({
			type: 'oauth2',
			flows: {
				authorizationCode: {
					authorizationUrl: 'https://auth.example.com/oauth/authorize',
					tokenUrl: 'https://auth.example.com/oauth/token',
					scopes: { profile: 'Read your profile' },
					'x-usePkce': 'SHA-256',
				},
			},
		});
		expect((doc.paths['/me'] as any).get.security).toEqual([
			{ app: ['profile'] },
		]);
	});

	it('leaves x-usePkce off an authorization-code scheme without PKCE', () => {
		const scheme = oauth2AuthorizationCode({
			authorizationUrl: 'https://auth.example.com/authorize',
			tokenUrl: 'https://auth.example.com/token',
			scopes: {},
			pkce: false,
		});

		expect(scheme.flows?.authorizationCode).not.toHaveProperty('x-usePkce');
	});

	it('still documents a bare authorizer with no scopes', async () => {
		const guarded = api
			.get('/guarded')
			.authorizer('iam')
			.handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([guarded]);

		expect((doc.paths['/guarded'] as any).get.security).toEqual([{ iam: [] }]);
	});

	it('refuses an alternative the surface does not expose', () => {
		const route = api.get('/orders');

		expect(() =>
			// @ts-expect-error - 'jwt' is not one of the surface's authorizers
			route.authorizers(['session', 'jwt']),
		).toThrow(AuthorizerNotAvailable);
		expect(() => route.authorizers([])).toThrow(NoAuthorizersGiven);
	});
});
