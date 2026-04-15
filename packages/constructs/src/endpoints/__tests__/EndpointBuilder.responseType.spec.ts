import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EndpointBuilder } from '../EndpointBuilder';

describe('EndpointBuilder.responseType', () => {
	it("defaults to 'application/json' when not set", () => {
		const endpoint = new EndpointBuilder('/users', 'GET')
			.output(z.object({ id: z.string() }))
			.handle(async () => ({ id: '1' }));

		expect(endpoint.responseType).toBe('application/json');
	});

	it('stores a custom response type on the built Endpoint', () => {
		const endpoint = new EndpointBuilder('/checkout-page', 'GET')
			.output(z.string())
			.responseType('text/html')
			.handle(async () => '<html></html>');

		expect(endpoint.responseType).toBe('text/html');
	});

	it('returns the builder for chaining', () => {
		const builder = new EndpointBuilder('/users', 'GET');
		const result = builder.responseType('text/plain');

		expect(result).toBe(builder);
	});

	it('supports any arbitrary MIME type', () => {
		const endpoint = new EndpointBuilder('/export.csv', 'GET')
			.output(z.string())
			.responseType('text/csv')
			.handle(async () => 'a,b,c\n1,2,3');

		expect(endpoint.responseType).toBe('text/csv');
	});

	it('last call wins when chained multiple times', () => {
		const endpoint = new EndpointBuilder('/pdf', 'GET')
			.responseType('text/html')
			.responseType('application/pdf')
			.handle(async () => 'pdf-bytes');

		expect(endpoint.responseType).toBe('application/pdf');
	});
});
