import { RestApi } from '@geekmidas/constructs/rest-api';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { createTypedFetcher } from '../fetcher';
import type { InferOpenApi } from '../infer';
import type { ExtractHeaderParams, FilteredRequestConfig } from '../types';

const api = new RestApi('TypedHeaders', {
	path: '.',
	defaultAuthorizer: 'none',
});

const pay = api
	.post('/payments')
	.headers(
		z.object({
			'idempotency-key': z.string(),
			'if-match': z.string().optional(),
		}),
	)
	.body(z.object({ amount: z.number() }))
	.output(z.object({ id: z.string() }))
	.handle(async () => ({ id: '1' }));
const list = api
	.get('/things')
	.headers(z.object({ 'if-none-match': z.string().optional() }))
	.query(z.object({ q: z.string().optional() }))
	.output(z.object({ ok: z.boolean() }))
	.handle(async () => ({ ok: true }));
const plain = api
	.get('/plain')
	.output(z.object({ ok: z.boolean() }))
	.handle(async () => ({ ok: true }));

type Paths = InferOpenApi<[typeof pay, typeof list, typeof plain]>['paths'];

describe('typed request headers', () => {
	it('requires a required header, and still allows others', () => {
		const client = createTypedFetcher<Paths>();
		client('POST /payments', {
			body: { amount: 1 },
			headers: { 'idempotency-key': 'k', 'x-extra': 'yes' },
		});
		client('POST /payments', {
			body: { amount: 1 },
			headers: { 'idempotency-key': 'k', 'if-match': '"v1"' },
		});
		// @ts-expect-error — `idempotency-key` is required
		client('POST /payments', { body: { amount: 1 } });
		client('POST /payments', {
			body: { amount: 1 },
			// @ts-expect-error — `idempotency-key` is required
			headers: { 'if-match': '"v1"' },
		});
	});

	it('leaves headers optional when none is required', () => {
		const client = createTypedFetcher<Paths>();
		client('GET /things');
		client('GET /things', { headers: { 'if-none-match': '"v1"' } });
		client('GET /things', { query: { q: 'x' } });
		client('GET /plain');
		client('GET /plain', { headers: { anything: 'goes' } });
	});

	it('reads the header parameters beside the query', () => {
		expectTypeOf<ExtractHeaderParams<Paths, '/things', 'get'>>().toEqualTypeOf<{
			'if-none-match'?: string | undefined;
		}>();
		expectTypeOf<
			ExtractHeaderParams<Paths, '/plain', 'get'>
		>().toEqualTypeOf<never>();
		expectTypeOf<
			FilteredRequestConfig<Paths, 'GET /plain'>['headers']
		>().toEqualTypeOf<Record<string, string> | undefined>();
	});

	it('types the headers of a generated `paths`', () => {
		type Generated = {
			'/payments': {
				post: {
					parameters: {
						header: { 'idempotency-key': string };
					};
					responses: {
						201: {
							headers: { ETag: string; [name: string]: unknown };
							content: { 'application/json': { id: string } };
						};
					};
				};
			};
		};
		const client = createTypedFetcher<Generated>();
		client('POST /payments', { headers: { 'idempotency-key': 'k' } });
		// @ts-expect-error — `idempotency-key` is required
		client('POST /payments', {});
		// @ts-expect-error — the config is required, for its headers
		client.post('/payments');
	});
});
