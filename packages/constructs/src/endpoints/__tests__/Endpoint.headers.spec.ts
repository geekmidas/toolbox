import { describe, expect, it } from 'vitest';
import { Endpoint } from '../Endpoint';

describe('Endpoint.createHeaders', () => {
	it('should get single header value', () => {
		const headerFn = Endpoint.createHeaders({
			'Content-Type': 'application/json',
			Host: 'example.com',
		});

		expect(headerFn('content-type')).toBe('application/json');
		expect(headerFn('host')).toBe('example.com');
	});

	it('should be case-insensitive for header names', () => {
		const headerFn = Endpoint.createHeaders({
			'Content-Type': 'application/json',
		});

		expect(headerFn('content-type')).toBe('application/json');
		expect(headerFn('Content-Type')).toBe('application/json');
		expect(headerFn('CONTENT-TYPE')).toBe('application/json');
		expect(headerFn('CoNtEnT-tYpE')).toBe('application/json');
	});

	it('should return undefined for non-existent header', () => {
		const headerFn = Endpoint.createHeaders({
			'Content-Type': 'application/json',
		});

		expect(headerFn('Authorization')).toBeUndefined();
	});

	it('should handle empty headers object', () => {
		const headerFn = Endpoint.createHeaders({});

		expect(headerFn('Content-Type')).toBeUndefined();
	});

	it('should handle headers with special characters', () => {
		const headerFn = Endpoint.createHeaders({
			'X-Custom-Header': 'value-with-dashes',
			'X-Request-ID': '12345-67890-abcdef',
		});

		expect(headerFn('x-custom-header')).toBe('value-with-dashes');
		expect(headerFn('X-REQUEST-ID')).toBe('12345-67890-abcdef');
	});

	it('should handle standard HTTP headers', () => {
		const headerFn = Endpoint.createHeaders({
			'Content-Type': 'application/json',
			'Content-Length': '1234',
			Authorization: 'Bearer token123',
			'User-Agent': 'Mozilla/5.0',
			Accept: 'application/json',
			'Accept-Language': 'en-US,en;q=0.9',
			'Cache-Control': 'no-cache',
		});

		expect(headerFn('content-type')).toBe('application/json');
		expect(headerFn('content-length')).toBe('1234');
		expect(headerFn('authorization')).toBe('Bearer token123');
		expect(headerFn('user-agent')).toBe('Mozilla/5.0');
		expect(headerFn('accept')).toBe('application/json');
		expect(headerFn('accept-language')).toBe('en-US,en;q=0.9');
		expect(headerFn('cache-control')).toBe('no-cache');
	});

	it('should handle forwarded headers', () => {
		const headerFn = Endpoint.createHeaders({
			'X-Forwarded-For': '203.0.113.1',
			'X-Forwarded-Proto': 'https',
			'X-Real-IP': '203.0.113.1',
		});

		expect(headerFn('x-forwarded-for')).toBe('203.0.113.1');
		expect(headerFn('x-forwarded-proto')).toBe('https');
		expect(headerFn('x-real-ip')).toBe('203.0.113.1');
	});

	describe('header() - get all headers', () => {
		it('should return all headers as object when called without arguments', () => {
			const headerFn = Endpoint.createHeaders({
				'Content-Type': 'application/json',
				Host: 'example.com',
				Authorization: 'Bearer token123',
			});

			const allHeaders = headerFn();

			expect(allHeaders).toEqual({
				'content-type': 'application/json',
				host: 'example.com',
				authorization: 'Bearer token123',
			});
		});

		it('should return empty object when no headers exist', () => {
			const headerFn = Endpoint.createHeaders({});

			const allHeaders = headerFn();

			expect(allHeaders).toEqual({});
		});

		it('should normalize all header names to lowercase', () => {
			const headerFn = Endpoint.createHeaders({
				'Content-Type': 'application/json',
				HOST: 'example.com',
				'X-Custom-Header': 'value',
			});

			const allHeaders = headerFn();

			expect(allHeaders).toEqual({
				'content-type': 'application/json',
				host: 'example.com',
				'x-custom-header': 'value',
			});
		});

		it('should work with standard HTTP headers', () => {
			const headerFn = Endpoint.createHeaders({
				'Content-Type': 'application/json',
				'Content-Length': '1234',
				Authorization: 'Bearer token123',
				'User-Agent': 'Mozilla/5.0',
				Accept: 'application/json',
			});

			const allHeaders = headerFn();

			expect(allHeaders).toEqual({
				'content-type': 'application/json',
				'content-length': '1234',
				authorization: 'Bearer token123',
				'user-agent': 'Mozilla/5.0',
				accept: 'application/json',
			});
		});

		it('should work with custom and forwarded headers', () => {
			const headerFn = Endpoint.createHeaders({
				'X-Forwarded-For': '203.0.113.1',
				'X-Forwarded-Proto': 'https',
				'X-Request-ID': 'req-123',
				'X-Custom-Header': 'custom-value',
			});

			const allHeaders = headerFn();

			expect(allHeaders).toEqual({
				'x-forwarded-for': '203.0.113.1',
				'x-forwarded-proto': 'https',
				'x-request-id': 'req-123',
				'x-custom-header': 'custom-value',
			});
		});

		it('should handle complex real-world headers', () => {
			const headerFn = Endpoint.createHeaders({
				'Content-Type': 'application/json; charset=utf-8',
				Host: 'api.example.com',
				Connection: 'keep-alive',
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
				Accept: '*/*',
				'Accept-Encoding': 'gzip, deflate, br',
				'Accept-Language': 'en-US,en;q=0.9',
				Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
				'Cache-Control': 'no-cache',
				Origin: 'https://example.com',
				Referer: 'https://example.com/dashboard',
				'X-Requested-With': 'XMLHttpRequest',
			});

			const allHeaders = headerFn();

			expect(allHeaders).toHaveProperty('content-type');
			expect(allHeaders).toHaveProperty('host');
			expect(allHeaders).toHaveProperty('authorization');
			expect(allHeaders).toHaveProperty('user-agent');
			expect(Object.keys(allHeaders).length).toBe(12);
		});
	});
});
