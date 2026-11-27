import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { RestApi } from '../../rest-api';
import { defineHeader } from '../headers';

const api = new RestApi('Test', { path: '.', defaultAuthorizer: 'none' });

const IdempotencyKey = defineHeader('Idempotency-Key', {
	schema: z.string(),
	description: 'Makes a retried request safe to repeat.',
});
const Trace = defineHeader('X-Trace', { description: 'Any string' });
const Forced = defineHeader('X-Forced', {
	schema: z.string().optional(),
	required: true,
});

describe('typed request headers', () => {
	it('types an object schema as the handler reads it', () => {
		api
			.get('/things')
			.headers(
				z.object({
					'x-page-size': z.coerce.number().default(10),
					'if-none-match': z.string().optional(),
				}),
			)
			.handle(async ({ headers, header }) => {
				expectTypeOf(headers).toEqualTypeOf<{
					'x-page-size': number;
					'if-none-match'?: string | undefined;
				}>();
				// The untyped accessor is still there.
				expectTypeOf(header('x-anything')).toEqualTypeOf<string | undefined>();
			});
	});

	it('types fields under their lower-cased names', () => {
		api
			.post('/payments')
			.headers({
				'Idempotency-Key': IdempotencyKey,
				'x-trace': Trace,
				'x-forced': Forced,
				'If-Match': z.string().optional(),
			})
			.handle(async ({ headers }) => {
				expectTypeOf(headers).toEqualTypeOf<{
					'idempotency-key': string;
					'x-forced': string;
					'x-trace'?: string;
					'if-match'?: string | undefined;
				}>();
			});
	});

	it('hands the authorizer the same headers', () => {
		api
			.post('/payments')
			.headers({ 'Idempotency-Key': IdempotencyKey })
			.authorize(({ headers }) => {
				expectTypeOf(headers['idempotency-key']).toEqualTypeOf<string>();
				return true;
			});
	});

	it('is absent from an endpoint that declared none', () => {
		api.get('/plain').handle(async (ctx) => {
			expectTypeOf(ctx).not.toHaveProperty('headers');
		});
	});
});

describe('defineHeader', () => {
	it('is required when its schema is, and optional without one', () => {
		expectTypeOf(IdempotencyKey.required).toEqualTypeOf<true>();
		expectTypeOf(Trace.required).toEqualTypeOf<false>();
		expectTypeOf(Forced.required).toEqualTypeOf<true>();
	});
});
