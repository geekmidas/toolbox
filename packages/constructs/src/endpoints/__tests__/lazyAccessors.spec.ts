import { describe, expect, it, vi } from 'vitest';
import {
	createApiGatewayCookies,
	createApiGatewayHeaders,
	createCookieHeaderAccessor,
	createNoopCookies,
	createNoopHeaders,
	createObjectHeaders,
} from '../lazyAccessors';

describe('lazyAccessors', () => {
	describe('createApiGatewayHeaders', () => {
		it('should return undefined for single key lookup with null headers', () => {
			const header = createApiGatewayHeaders(null);
			expect(header('content-type')).toBeUndefined();
		});

		it('should return undefined for single key lookup with undefined headers', () => {
			const header = createApiGatewayHeaders(undefined);
			expect(header('content-type')).toBeUndefined();
		});

		it('should return empty object for all headers when headers is null', () => {
			const header = createApiGatewayHeaders(null);
			expect(header()).toEqual({});
		});

		it('should return header value for direct key lookup', () => {
			const header = createApiGatewayHeaders({
				'content-type': 'application/json',
				authorization: 'Bearer token',
			});
			expect(header('content-type')).toBe('application/json');
			expect(header('authorization')).toBe('Bearer token');
		});

		it('should handle case-insensitive lookups', () => {
			const header = createApiGatewayHeaders({
				'Content-Type': 'application/json',
			});
			expect(header('content-type')).toBe('application/json');
			expect(header('CONTENT-TYPE')).toBe('application/json');
		});

		it('should return all headers normalized to lowercase', () => {
			const header = createApiGatewayHeaders({
				'Content-Type': 'application/json',
				Authorization: 'Bearer token',
			});
			const all = header();
			expect(all).toEqual({
				'content-type': 'application/json',
				authorization: 'Bearer token',
			});
		});

		it('should cache normalized headers', () => {
			const headers = {
				'Content-Type': 'application/json',
			};
			const header = createApiGatewayHeaders(headers);

			// First call should normalize
			const first = header();
			// Second call should return cached
			const second = header();

			expect(first).toBe(second);
		});

		it('should skip undefined header values', () => {
			const header = createApiGatewayHeaders({
				'content-type': 'application/json',
				'x-custom': undefined,
			});
			const all = header();
			expect(all).toEqual({
				'content-type': 'application/json',
			});
			expect(header('x-custom')).toBeUndefined();
		});

		it('should handle mixed case lookups with fallback to normalized', () => {
			const header = createApiGatewayHeaders({
				'X-Custom-Header': 'value',
			});
			// Direct lookup fails, fallback to normalized
			expect(header('x-custom-header')).toBe('value');
		});
	});

	describe('createApiGatewayCookies', () => {
		it('should parse cookies from array format (API Gateway v2)', () => {
			const cookie = createApiGatewayCookies(
				['session=abc123', 'user=john'],
				undefined,
			);
			expect(cookie('session')).toBe('abc123');
			expect(cookie('user')).toBe('john');
		});

		it('should return all cookies when called without arguments', () => {
			const cookie = createApiGatewayCookies(
				['session=abc123', 'user=john'],
				undefined,
			);
			expect(cookie()).toEqual({
				session: 'abc123',
				user: 'john',
			});
		});

		it('should fall back to cookie header when cookies array is undefined', () => {
			const cookie = createApiGatewayCookies(
				undefined,
				'session=abc123; user=john',
			);
			expect(cookie('session')).toBe('abc123');
			expect(cookie('user')).toBe('john');
		});

		it('should decode URL-encoded values', () => {
			const cookie = createApiGatewayCookies(
				['name=John%20Doe', 'path=%2Fhome'],
				undefined,
			);
			expect(cookie('name')).toBe('John Doe');
			expect(cookie('path')).toBe('/home');
		});

		it('should decode URL-encoded values from cookie header', () => {
			const cookie = createApiGatewayCookies(
				undefined,
				'name=John%20Doe; path=%2Fhome',
			);
			expect(cookie('name')).toBe('John Doe');
			expect(cookie('path')).toBe('/home');
		});

		it('should return undefined for missing cookie', () => {
			const cookie = createApiGatewayCookies(['session=abc123'], undefined);
			expect(cookie('missing')).toBeUndefined();
		});

		it('should return empty object when no cookies present', () => {
			const cookie = createApiGatewayCookies(undefined, undefined);
			expect(cookie()).toEqual({});
		});

		it('should cache parsed cookies', () => {
			const cookie = createApiGatewayCookies(['session=abc123'], undefined);
			const first = cookie();
			const second = cookie();
			expect(first).toBe(second);
		});

		it('should skip malformed cookies in array', () => {
			const cookie = createApiGatewayCookies(
				['valid=value', 'malformed', '=nokey'],
				undefined,
			);
			expect(cookie()).toEqual({
				valid: 'value',
			});
		});

		it('should skip malformed cookies in header', () => {
			const cookie = createApiGatewayCookies(
				undefined,
				'valid=value; malformed; =nokey',
			);
			expect(cookie()).toEqual({
				valid: 'value',
			});
		});
	});

	describe('createObjectHeaders', () => {
		it('should return header value for direct lookup', () => {
			const header = createObjectHeaders({
				'content-type': 'application/json',
			});
			expect(header('content-type')).toBe('application/json');
		});

		it('should handle case-insensitive lookups', () => {
			const header = createObjectHeaders({
				'Content-Type': 'application/json',
			});
			expect(header('content-type')).toBe('application/json');
			expect(header('CONTENT-TYPE')).toBe('application/json');
		});

		it('should return all headers when called without arguments', () => {
			const header = createObjectHeaders({
				'Content-Type': 'application/json',
				Authorization: 'Bearer token',
			});
			expect(header()).toEqual({
				'content-type': 'application/json',
				authorization: 'Bearer token',
			});
		});

		it('should return undefined for missing header', () => {
			const header = createObjectHeaders({
				'content-type': 'application/json',
			});
			expect(header('missing')).toBeUndefined();
		});

		it('should return empty object for undefined headers', () => {
			const header = createObjectHeaders(undefined);
			expect(header()).toEqual({});
		});

		it('should return undefined for key lookup with undefined headers', () => {
			const header = createObjectHeaders(undefined);
			expect(header('content-type')).toBeUndefined();
		});

		it('should cache normalized headers', () => {
			const header = createObjectHeaders({
				'Content-Type': 'application/json',
			});
			const first = header();
			const second = header();
			expect(first).toBe(second);
		});

		it('should normalize headers on single key lookup that requires fallback', () => {
			const header = createObjectHeaders({
				'X-Custom': 'value',
			});
			// First lookup triggers normalization
			expect(header('x-custom')).toBe('value');
			// Subsequent lookups use cached normalized version
			expect(header('X-CUSTOM')).toBe('value');
		});
	});

	describe('createCookieHeaderAccessor', () => {
		it('should parse cookies from header string', () => {
			const cookie = createCookieHeaderAccessor('session=abc123; user=john');
			expect(cookie('session')).toBe('abc123');
			expect(cookie('user')).toBe('john');
		});

		it('should return all cookies when called without arguments', () => {
			const cookie = createCookieHeaderAccessor('session=abc123; user=john');
			expect(cookie()).toEqual({
				session: 'abc123',
				user: 'john',
			});
		});

		it('should decode URL-encoded values', () => {
			const cookie = createCookieHeaderAccessor(
				'name=John%20Doe; path=%2Fhome',
			);
			expect(cookie('name')).toBe('John Doe');
			expect(cookie('path')).toBe('/home');
		});

		it('should return undefined for missing cookie', () => {
			const cookie = createCookieHeaderAccessor('session=abc123');
			expect(cookie('missing')).toBeUndefined();
		});

		it('should return empty object for undefined cookie header', () => {
			const cookie = createCookieHeaderAccessor(undefined);
			expect(cookie()).toEqual({});
		});

		it('should cache parsed cookies', () => {
			const cookie = createCookieHeaderAccessor('session=abc123');
			const first = cookie();
			const second = cookie();
			expect(first).toBe(second);
		});

		it('should skip malformed cookies', () => {
			const cookie = createCookieHeaderAccessor(
				'valid=value; malformed; =nokey',
			);
			expect(cookie()).toEqual({
				valid: 'value',
			});
		});

		it('should handle cookies with equals signs in value', () => {
			const cookie = createCookieHeaderAccessor('token=abc=def=ghi');
			expect(cookie('token')).toBe('abc=def=ghi');
		});

		it('should handle extra whitespace', () => {
			const cookie = createCookieHeaderAccessor(
				'  session=abc123  ;   user=john  ',
			);
			expect(cookie('session')).toBe('abc123');
			expect(cookie('user')).toBe('john');
		});
	});

	describe('createNoopHeaders', () => {
		it('should return undefined for any key lookup', () => {
			const header = createNoopHeaders();
			expect(header('content-type')).toBeUndefined();
			expect(header('any-header')).toBeUndefined();
		});

		it('should return empty object when called without arguments', () => {
			const header = createNoopHeaders();
			expect(header()).toEqual({});
		});
	});

	describe('createNoopCookies', () => {
		it('should return undefined for any name lookup', () => {
			const cookie = createNoopCookies();
			expect(cookie('session')).toBeUndefined();
			expect(cookie('any-cookie')).toBeUndefined();
		});

		it('should return empty object when called without arguments', () => {
			const cookie = createNoopCookies();
			expect(cookie()).toEqual({});
		});
	});
});
