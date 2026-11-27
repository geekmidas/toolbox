import { defineHeader, RestApi } from '@geekmidas/constructs/rest-api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { OpenApiTsGenerator } from '../OpenApiTsGenerator';

/**
 * Request headers in the generated `paths` as `parameters.header`, and a
 * response's declared headers as its `headers`.
 */
const api = new RestApi('Headers', { path: '.', defaultAuthorizer: 'none' });

const IdempotencyKey = defineHeader('Idempotency-Key', {
	schema: z.string(),
	description: 'Makes a retried request safe to repeat.',
});
const ETag = defineHeader('ETag', { schema: z.string() });

const generate = (endpoints: unknown[]) =>
	new OpenApiTsGenerator().generate(endpoints as never);

/** The `paths` entry for one route, as text. */
function pathEntry(content: string, route: string): string {
	const start = content.indexOf(`'${route}': {`);
	const end = content.indexOf('\n  };', start);
	return content.slice(start, end);
}

describe('OpenApiTsGenerator — headers', () => {
	it('writes request headers as `parameters.header`, quoted', async () => {
		const pay = api
			.post('/payments')
			.headers({
				'Idempotency-Key': IdempotencyKey,
				'if-match': z.string().optional(),
			})
			.handle(async () => ({}));

		const content = await generate([pay]);

		expect(content).toContain(
			"export interface PostPaymentsHeaders {\n  'idempotency-key': string;\n  'if-match'?: string;\n}",
		);
		expect(pathEntry(content, '/payments')).toContain(
			'parameters: {\n        header: PostPaymentsHeaders;\n      }',
		);
	});

	it('writes the header beside the query, and a defaulted header as optional', async () => {
		const list = api
			.get('/things')
			.query(z.object({ q: z.string().optional() }))
			.headers(z.object({ 'x-page-size': z.coerce.number().default(10) }))
			.handle(async () => []);

		const content = await generate([list]);

		expect(pathEntry(content, '/things')).toContain(
			'parameters: {\n        query: GetThingsQuery;\n        header: GetThingsHeaders;\n      }',
		);
		expect(content).toMatch(
			/export interface GetThingsHeaders \{\n {2}'x-page-size'\?: /,
		);
	});

	it('writes a response’s declared headers under it', async () => {
		const get = api
			.get('/things/:id')
			.responseHeaders({
				ETag,
				'Retry-After': { schema: z.string().optional() },
			})
			.handle(async () => ({}));

		const entry = pathEntry(await generate([get]), '/things/{id}');

		expect(entry).toContain(
			"headers: { 'ETag': string; 'Retry-After'?: string; [name: string]: unknown };",
		);
	});

	it('writes no headers for an endpoint that declares none', async () => {
		const plain = api.get('/plain').handle(async () => ({}));

		const entry = pathEntry(await generate([plain]), '/plain');

		expect(entry).not.toContain('header');
	});
});
