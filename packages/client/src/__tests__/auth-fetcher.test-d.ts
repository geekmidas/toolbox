import { describe, expectTypeOf, it } from 'vitest';
import type {
	AuthFetcherOptions,
	AuthStrategy,
	RequiredSecuritySchemes,
	UsedSecuritySchemes,
} from '../auth-fetcher';

/** As `gkm openapi --ts` writes it: one scheme, alternatives, or public. */
const endpointAuth = {
	'GET /users': null,
	'GET /me': 'session',
	'GET /orders': ['session', 'partners'],
	'POST /reports': ['partners', 'apiKey'],
} as const;

type EndpointAuth = typeof endpointAuth;
type Strategies = AuthFetcherOptions<
	EndpointAuth,
	Record<string, { type: 'oauth2' }>
>['authStrategies'];

describe('authStrategies for an API whose endpoints accept alternatives', () => {
	it('uses every scheme any endpoint accepts', () => {
		expectTypeOf<UsedSecuritySchemes<EndpointAuth>>().toEqualTypeOf<
			'session' | 'partners' | 'apiKey'
		>();
	});

	it('requires a strategy only for a scheme some endpoint has alone', () => {
		expectTypeOf<
			RequiredSecuritySchemes<EndpointAuth>
		>().toEqualTypeOf<'session'>();

		const bearer: AuthStrategy = { type: 'none' };
		expectTypeOf({ session: bearer }).toExtend<Strategies>();
		expectTypeOf({ session: bearer, partners: bearer }).toExtend<Strategies>();
		expectTypeOf({ partners: bearer }).not.toExtend<Strategies>();
	});
});
