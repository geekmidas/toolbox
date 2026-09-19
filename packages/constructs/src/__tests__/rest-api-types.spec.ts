import { describe, expectTypeOf, it } from 'vitest';
import { RestApi } from '../rest-api';

/**
 * Compile-time assertions, checked by `pnpm ts:check` rather than by running.
 *
 * A `@ts-expect-error` that stops erroring *is* the failure: TypeScript reports
 * the directive as unused, and the build stops. So these run in CI even though
 * their bodies assert almost nothing at runtime.
 */

describe('RestApiConfig.defaultAuthorizer', () => {
	it('accepts a name the surface exposes', () => {
		const api = new RestApi('Api', {
			authorizers: ['iam', 'session'],
			defaultAuthorizer: 'session',
		});

		expectTypeOf(api.id).toEqualTypeOf<'Api'>();
	});

	it("accepts 'none', which is how an endpoint says public", () => {
		new RestApi('Api', { authorizers: ['iam'], defaultAuthorizer: 'none' });
	});

	it('accepts a built-in scheme without listing it', () => {
		new RestApi('Api', { defaultAuthorizer: 'jwt' });
	});

	it('rejects a name the surface does not expose', () => {
		new RestApi('Api', {
			authorizers: ['iam'],
			// A bare `string` let this through, and every endpoint on the surface
			// then defaulted to an authorizer that does not exist.
			// @ts-expect-error — 'jwtt' is not one of ['iam'], a built-in, or 'none'
			defaultAuthorizer: 'jwtt',
		});
	});

	it('rejects a name when the surface exposes none of its own', () => {
		// @ts-expect-error — nothing declared, so only built-ins and 'none'
		new RestApi('Api', { defaultAuthorizer: 'session' });
	});
});
