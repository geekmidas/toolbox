import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { RestApi } from '../../rest-api';
import type { EndpointOutput } from '../Endpoint';
import {
	type BinaryBody,
	binary,
	type DeclaredResponsesOf,
	type DefaultSchemaOf,
} from '../responses';

const api = new RestApi('Test', { path: '.', defaultAuthorizer: 'none' });

const Order = z.object({ id: z.string(), total: z.number() });
const Retry = z.object({ id: z.string(), retried: z.literal(true) });

describe('.response()', () => {
	it('lets the handler answer a declared response', () => {
		api
			.put('/orders/:id')
			.output(Order)
			.status(201)
			.response(200, Retry)
			.handle(async (_ctx, response) =>
				Math.random() > 0.5
					? response.status(200).send({ id: '1', retried: true as const })
					: { id: '1', total: 1 },
			);

		api
			.put('/orders/:id')
			.output(Order)
			// @ts-expect-error neither the default output nor a declared response
			.handle(async () => ({ id: '1', retried: true }));
	});

	it('types each content type of a response', () => {
		const report = api
			.get('/reports/:id')
			.response(200, {
				'application/json': Order,
				'text/csv': z.string(),
				'application/pdf': binary(),
			})
			.handle(async () => new Uint8Array());

		type Out = EndpointOutput<typeof report>;
		expectTypeOf<Out>().toEqualTypeOf<
			z.infer<typeof Order> | string | BinaryBody
		>();
	});

	it('keeps the default schema and each declared response for the client', () => {
		const put = api
			.put('/orders/:id')
			.output(Order)
			.response(200, Retry)
			.response(202)
			.handle(async () => ({ id: '1', total: 1 }));

		type Schema = typeof put extends { outputSchema?: infer S } ? S : never;
		expectTypeOf<DefaultSchemaOf<NonNullable<Schema>>>().toEqualTypeOf<
			typeof Order
		>();
		expectTypeOf<DeclaredResponsesOf<NonNullable<Schema>>>().toEqualTypeOf<
			Omit<
				Omit<{}, 200> & { 200: { 'application/json': typeof Retry } },
				202
			> & {
				202: {};
			}
		>();
		expectTypeOf<EndpointOutput<typeof put>>().toEqualTypeOf<
			z.infer<typeof Order> | z.infer<typeof Retry>
		>();
	});
});
