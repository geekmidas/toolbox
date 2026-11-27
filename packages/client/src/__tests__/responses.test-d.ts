import { binary } from '@geekmidas/constructs/endpoints';
import { RestApi } from '@geekmidas/constructs/rest-api';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { InferOpenApi, InferOpenApiFromEndpoint } from '../infer';
import type { ExtractEndpointResponse, TypedApiFunction } from '../types';

const api = new RestApi('Responses', { path: '.', defaultAuthorizer: 'none' });

const Order = z.object({ id: z.string(), total: z.number() });
const Retry = z.object({ id: z.string(), retried: z.literal(true) });
const Report = z.object({ id: z.string(), rows: z.number() });

type Order = z.infer<typeof Order>;
type Retry = z.infer<typeof Retry>;
type Report = z.infer<typeof Report>;

const putOrder = api
	.put('/orders/:id')
	.params(z.object({ id: z.string() }))
	.output(Order)
	.status(201)
	.response(201, Order)
	.response(200, Retry)
	.handle(async ({ params }) => ({ id: params.id, total: 1 }));

const getReport = api
	.get('/reports/:id')
	.params(z.object({ id: z.string() }))
	.response(200, {
		'application/json': Report,
		'text/csv': z.string(),
		'application/pdf': binary(),
	})
	.handle(async ({ params }) => ({ id: params.id, rows: 1 }));

describe('an endpoint with several responses', () => {
	it('infers every declared status', () => {
		type Responses = InferOpenApiFromEndpoint<
			typeof putOrder
		>['paths']['/orders/{id}']['put']['responses'];

		expectTypeOf<
			Responses[201]['content']['application/json']
		>().toEqualTypeOf<Order>();
		// 200 is where `.output()` is typed when the status is not known, so a
		// declared 200 is merged with it.
		expectTypeOf<Responses[200]['content']['application/json']>().toEqualTypeOf<
			Order | Retry
		>();
	});

	it('infers every content type of a response', () => {
		type Content = InferOpenApiFromEndpoint<
			typeof getReport
		>['paths']['/reports/{id}']['get']['responses'][200]['content'];

		expectTypeOf<Content['application/json']>().toEqualTypeOf<Report>();
		expectTypeOf<Content['text/csv']>().toEqualTypeOf<string>();
		expectTypeOf<Content>().toHaveProperty('application/pdf');
	});

	it('the client resolves to any of the JSON alternatives', () => {
		type Paths = InferOpenApi<[typeof putOrder, typeof getReport]>['paths'];

		expectTypeOf<
			ExtractEndpointResponse<Paths, 'PUT /orders/{id}'>
		>().toEqualTypeOf<Order | Retry>();
		expectTypeOf<
			ExtractEndpointResponse<Paths, 'GET /reports/{id}'>
		>().toEqualTypeOf<Report>();

		const client = null as unknown as TypedApiFunction<Paths>;
		expectTypeOf(
			client('PUT /orders/{id}', { params: { id: '1' } }),
		).resolves.toEqualTypeOf<Order | Retry>();
	});
});

describe('documents openapi-typescript wrote', () => {
	interface paths {
		'/orders/{id}': {
			put: {
				responses: {
					200: { content: { 'application/json': Retry } };
					201: { content: { 'application/json': Order } };
					204: { content?: never };
					404: { content: { 'application/json': { message: string } } };
				};
			};
		};
		'/reports/{id}': {
			get: {
				responses: {
					200: {
						content: { 'text/csv': string; 'application/json': Report };
					};
				};
			};
		};
	}

	it('resolves to a union over every 2xx JSON body, and no error body', () => {
		expectTypeOf<
			ExtractEndpointResponse<paths, 'PUT /orders/{id}'>
		>().toEqualTypeOf<Order | Retry>();
	});

	it('reads the JSON body of a response with several content types', () => {
		expectTypeOf<
			ExtractEndpointResponse<paths, 'GET /reports/{id}'>
		>().toEqualTypeOf<Report>();
	});
});
