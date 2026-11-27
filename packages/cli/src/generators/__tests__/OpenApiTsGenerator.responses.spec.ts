import { binary } from '@geekmidas/constructs/endpoints';
import { RestApi } from '@geekmidas/constructs/rest-api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenApiTsGenerator } from '../OpenApiTsGenerator';

const api = new RestApi('Responses', { path: '.', defaultAuthorizer: 'none' });

/** The `responses: { … }` of the one operation in `content`. */
function responsesOf(content: string): string {
	const start = content.indexOf('responses: {');
	const end = content.indexOf('\n      }', start);
	return content.slice(start, end).replace(/\s+/g, ' ');
}

describe('OpenApiTsGenerator — declared responses', () => {
	it('types the default response under the status it answers', async () => {
		const create = api
			.post('/things')
			.status(201)
			.output(z.object({ id: z.string() }))
			.handle(async () => ({ id: '1' }));

		const content = await new OpenApiTsGenerator().generate([create as any]);

		expect(responsesOf(content)).toBe(
			"responses: { 201: { content: { 'application/json': PostThingsOutput; }; };",
		);
	});

	it('types each declared status beside the default one', async () => {
		const put = api
			.put('/orders/:id')
			.params(z.object({ id: z.string() }))
			.output(z.object({ id: z.string(), total: z.number() }))
			.status(201)
			.response(200, z.object({ id: z.string(), retried: z.literal(true) }))
			.response(202)
			.handle(async () => ({ id: '1', total: 1 }));

		const content = await new OpenApiTsGenerator().generate([put as any]);

		expect(responsesOf(content)).toBe(
			[
				'responses: {',
				"201: { content: { 'application/json': PutOrdersIdOutput; }; };",
				"200: { content: { 'application/json': PutOrdersIdResponse200; }; };",
				'202: { content?: never; };',
			].join(' '),
		);
		expect(content).toContain(
			'export interface PutOrdersIdResponse200 {\n  id: string;\n  retried: true;\n}',
		);
	});

	it('types each content type of a response, a binary one as a Blob', async () => {
		const report = api
			.get('/reports/:id')
			.params(z.object({ id: z.string() }))
			.response(200, {
				'application/json': z.object({ id: z.string(), rows: z.number() }),
				'text/csv': z.string(),
				'application/pdf': binary(),
			})
			.handle(async () => ({ id: '1', rows: 1 }));

		const content = await new OpenApiTsGenerator().generate([report as any]);

		expect(responsesOf(content)).toBe(
			[
				'responses: { 200: { content: {',
				"'application/json': GetReportsIdResponse200;",
				"'text/csv': GetReportsIdResponse200TextCsv;",
				"'application/pdf': Blob;",
				'}; };',
			].join(' '),
		);
		expect(content).toContain(
			'export interface GetReportsIdResponse200 {\n  id: string;\n  rows: number;\n}',
		);
		expect(content).toContain(
			'export type GetReportsIdResponse200TextCsv = string;',
		);
	});

	it('names a registered schema by its id', async () => {
		const Receipt = z
			.object({ id: z.string() })
			.meta({ id: 'GeneratedReceipt' });
		const endpoint = api
			.post('/receipts')
			.response(201, Receipt)
			.handle(async () => ({ id: '1' }));

		const content = await new OpenApiTsGenerator().generate([endpoint as any]);

		expect(responsesOf(content)).toContain(
			"201: { content: { 'application/json': GeneratedReceipt; }; };",
		);
		expect(content).toContain('export interface GeneratedReceipt {');
	});
});
