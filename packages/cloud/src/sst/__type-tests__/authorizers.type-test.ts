// Type-level tests for the Api authorizer generics. Checked by `ts:check:sst`
// (it's under src/sst and not a *.spec.ts, so the gate type-checks it; vitest
// ignores it). Each `@ts-expect-error` self-validates: if the enforcement
// regresses, the now-unused directive becomes a TS error the gate catches.

import { Api } from '../Api';
import { App } from '../App';
import { Function } from '../Function';

const stack = new App({
	name: 'a',
	stage: 'dev',
	domain: 'example.com',
	hostedZoneId: 'Z',
	region: 'us-east-1',
}).stack('api');

// Valid: built-ins (`iam`/`none`) plus the declared `jwt` and custom names.
export const ok = new Api(stack, 'Ok', {
	authorizers: {
		jwt: { issuer: 'https://issuer', audiences: ['aud'] },
		employee: { handler: 'src/employee-auth.handler' },
	},
	routes: [
		{ method: 'GET', path: '/a', handler: 'a.handler', authorizer: 'iam' },
		{ method: 'GET', path: '/b', handler: 'b.handler', authorizer: 'none' },
		{ method: 'GET', path: '/c', handler: 'c.handler', authorizer: 'jwt' },
		{ method: 'GET', path: '/d', handler: 'd.handler', authorizer: 'employee' },
		{ method: 'GET', path: '/e', handler: 'e.handler' },
	],
});

// An undeclared authorizer name is rejected.
export const badName = new Api(stack, 'BadName', {
	authorizers: { jwt: { issuer: 'i', audiences: ['a'] } },
	routes: [
		{
			method: 'GET',
			path: '/x',
			handler: 'x.handler',
			// @ts-expect-error 'nope' is not a declared authorizer
			authorizer: 'nope',
		},
	],
});

// A `jwt` authorizer must supply JWT settings (`audiences` required here).
export const badJwt = new Api(stack, 'BadJwt', {
	authorizers: {
		// @ts-expect-error jwt requires `audiences`
		jwt: { issuer: 'i' },
	},
	routes: [],
});

// A custom (Lambda) authorizer must supply a `handler`.
export const badLambda = new Api(stack, 'BadLambda', {
	authorizers: {
		// @ts-expect-error custom authorizer requires `handler`
		employee: { payload: '2.0' },
	},
	routes: [],
});

// A Lambda authorizer `handler` accepts one of our `Function` constructs.
const authFn = new Function(stack, 'AuthFn', { handler: 'src/auth.handler' });
export const okFnHandler = new Api(stack, 'OkFn', {
	authorizers: { employee: { handler: authFn } },
	routes: [
		{ method: 'GET', path: '/x', handler: 'x.handler', authorizer: 'employee' },
	],
});
