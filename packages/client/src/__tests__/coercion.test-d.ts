import { RestApi } from '@geekmidas/constructs/rest-api';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { InferOpenApiFromEndpoint } from '../infer';

const api = new RestApi('Coercion', { defaultAuthorizer: 'none' });

/**
 * A coercing schema has two types, and the client sits on the opposite side of
 * them from the handler.
 *
 * The client *sends* the input and *reads* the output. Typing a request body
 * from the output made the framework reject at compile time exactly what it
 * accepts at runtime — and query parameters made it plainest, since a query
 * string is text on the wire and can never be the number the schema produces.
 */
describe('the request is typed from what the caller sends', () => {
	it('takes the pre-coercion type in a body, and hands the handler the parsed one', () => {
		const endpoint = api
			.post('/measurements')
			.body(z.object({ weight: z.string().transform(Number) }))
			.output(z.object({ id: z.string() }))
			.handle(async ({ body }) => {
				// The handler is downstream of parsing.
				expectTypeOf(body.weight).toEqualTypeOf<number>();
				return { id: '1' };
			});

		type Body = NonNullable<
			InferOpenApiFromEndpoint<
				typeof endpoint
			>['paths']['/measurements']['post']['requestBody']
		>['content']['application/json'];

		expectTypeOf<Body>().toEqualTypeOf<{ weight: string }>();
	});

	it('takes a string query parameter, because that is what a URL holds', () => {
		const endpoint = api
			.get('/measurements')
			.query(z.object({ limit: z.string().transform(Number) }))
			.output(z.object({ count: z.number() }))
			.handle(async ({ query }) => {
				expectTypeOf(query.limit).toEqualTypeOf<number>();
				return { count: 0 };
			});

		type Query = InferOpenApiFromEndpoint<
			typeof endpoint
		>['paths']['/measurements']['get']['parameters']['query'];

		expectTypeOf<Query>().toEqualTypeOf<{ limit: string }>();
	});

	it('still returns the parsed type in the response', () => {
		const endpoint = api
			.get('/measurements/{id}')
			.params(z.object({ id: z.string() }))
			.output(z.object({ weight: z.string().transform(Number) }))
			.handle(async () => ({ weight: '100' }));

		type Response = InferOpenApiFromEndpoint<
			typeof endpoint
		>['paths']['/measurements/{id}']['get']['responses'][200]['content']['application/json'];

		// A response is read rather than sent, so the client sees what parsing made.
		expectTypeOf<Response>().toEqualTypeOf<{ weight: number }>();
	});

	it('changes nothing for a schema that coerces nothing', () => {
		const endpoint = api
			.post('/users')
			.body(z.object({ name: z.string(), email: z.email() }))
			.output(z.object({ id: z.uuid() }))
			.handle(async () => ({ id: crypto.randomUUID() }));

		type Body = NonNullable<
			InferOpenApiFromEndpoint<
				typeof endpoint
			>['paths']['/users']['post']['requestBody']
		>['content']['application/json'];

		expectTypeOf<Body>().toEqualTypeOf<{ name: string; email: string }>();
	});
});
