import { e } from '@geekmidas/constructs/endpoints';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenApiTsGenerator } from '../OpenApiTsGenerator';

describe('OpenApiTsGenerator — responseType', () => {
	it("emits 'application/json' in paths when responseType is default", async () => {
		const endpoint = e
			.get('/users')
			.output(z.object({ id: z.string() }))
			.handle(async () => ({ id: '1' }));

		const generator = new OpenApiTsGenerator();
		const content = await generator.generate([endpoint as any]);

		// Default JSON content-type in the paths interface
		expect(content).toContain("'application/json':");
	});

	it("emits 'text/html' when the endpoint declares responseType('text/html')", async () => {
		const endpoint = e
			.get('/checkout-page')
			.output(z.string())
			.responseType('text/html')
			.handle(async () => '<html></html>');

		const generator = new OpenApiTsGenerator();
		const content = await generator.generate([endpoint as any]);

		// Paths interface should reference text/html, not application/json,
		// for this endpoint's 200 response
		expect(content).toContain("'text/html':");
	});

	it('keeps JSON content-type for other endpoints when one uses a custom responseType', async () => {
		const htmlEndpoint = e
			.get('/page')
			.output(z.string())
			.responseType('text/html')
			.handle(async () => '<html></html>');

		const jsonEndpoint = e
			.get('/users')
			.output(z.object({ id: z.string() }))
			.handle(async () => ({ id: '1' }));

		const generator = new OpenApiTsGenerator();
		const content = await generator.generate([
			htmlEndpoint as any,
			jsonEndpoint as any,
		]);

		expect(content).toContain("'text/html':");
		expect(content).toContain("'application/json':");
	});
});
