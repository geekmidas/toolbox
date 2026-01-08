import { describe, expect, it } from 'vitest';
import { Endpoint } from '../Endpoint';

describe('Endpoint.createCookies', () => {
	it('should parse single cookie', () => {
		const cookieFn = Endpoint.createCookies('session=abc123');

		expect(cookieFn('session')).toBe('abc123');
	});

	it('should parse multiple cookies', () => {
		const cookieFn = Endpoint.createCookies(
			'session=abc123; theme=dark; lang=en',
		);

		expect(cookieFn('session')).toBe('abc123');
		expect(cookieFn('theme')).toBe('dark');
		expect(cookieFn('lang')).toBe('en');
	});

	it('should handle cookies with spaces', () => {
		const cookieFn = Endpoint.createCookies('session=abc123 ; theme=dark');

		expect(cookieFn('session')).toBe('abc123');
		expect(cookieFn('theme')).toBe('dark');
	});

	it('should handle URL encoded values', () => {
		const cookieFn = Endpoint.createCookies(
			'user=John%20Doe; email=john%40example.com',
		);

		expect(cookieFn('user')).toBe('John Doe');
		expect(cookieFn('email')).toBe('john@example.com');
	});

	it('should handle cookies with equals sign in value', () => {
		const cookieFn = Endpoint.createCookies(
			'data=key=value; token=abc=123=xyz',
		);

		expect(cookieFn('data')).toBe('key=value');
		expect(cookieFn('token')).toBe('abc=123=xyz');
	});

	it('should return undefined for non-existent cookie', () => {
		const cookieFn = Endpoint.createCookies('session=abc123');

		expect(cookieFn('nonexistent')).toBeUndefined();
	});

	it('should handle empty cookie string', () => {
		const cookieFn = Endpoint.createCookies('');

		expect(cookieFn('session')).toBeUndefined();
	});

	it('should handle undefined cookie string', () => {
		const cookieFn = Endpoint.createCookies(undefined);

		expect(cookieFn('session')).toBeUndefined();
	});

	it('should handle malformed cookies gracefully', () => {
		const cookieFn = Endpoint.createCookies('session=; =value; valid=okay');

		expect(cookieFn('session')).toBe('');
		expect(cookieFn('valid')).toBe('okay');
	});

	it('should handle cookies with special characters', () => {
		const cookieFn = Endpoint.createCookies(
			'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
		);

		expect(cookieFn('token')).toBe(
			'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
		);
	});

	it('should handle cookies with numeric values', () => {
		const cookieFn = Endpoint.createCookies('count=42; price=19.99');

		expect(cookieFn('count')).toBe('42');
		expect(cookieFn('price')).toBe('19.99');
	});

	it('should handle empty cookie value', () => {
		const cookieFn = Endpoint.createCookies('empty=; session=abc123');

		expect(cookieFn('empty')).toBe('');
		expect(cookieFn('session')).toBe('abc123');
	});

	it('should preserve case sensitivity in cookie names', () => {
		const cookieFn = Endpoint.createCookies('Session=abc; session=xyz');

		expect(cookieFn('Session')).toBe('abc');
		expect(cookieFn('session')).toBe('xyz');
	});

	it('should handle cookies with trailing semicolon', () => {
		const cookieFn = Endpoint.createCookies('session=abc123; theme=dark;');

		expect(cookieFn('session')).toBe('abc123');
		expect(cookieFn('theme')).toBe('dark');
	});

	it('should handle complex real-world cookie string', () => {
		const cookieFn = Endpoint.createCookies(
			'session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9; user_id=12345; preferences=%7B%22theme%22%3A%22dark%22%7D; _ga=GA1.2.123456789.1234567890; authenticated=true',
		);

		expect(cookieFn('session')).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
		expect(cookieFn('user_id')).toBe('12345');
		expect(cookieFn('preferences')).toBe('{"theme":"dark"}');
		expect(cookieFn('_ga')).toBe('GA1.2.123456789.1234567890');
		expect(cookieFn('authenticated')).toBe('true');
	});

	describe('cookie() - get all cookies', () => {
		it('should return all cookies as object when called without arguments', () => {
			const cookieFn = Endpoint.createCookies(
				'session=abc123; theme=dark; lang=en',
			);

			const allCookies = cookieFn();

			expect(allCookies).toEqual({
				session: 'abc123',
				theme: 'dark',
				lang: 'en',
			});
		});

		it('should return empty object when no cookies exist', () => {
			const cookieFn = Endpoint.createCookies(undefined);

			const allCookies = cookieFn();

			expect(allCookies).toEqual({});
		});

		it('should return empty object for empty cookie string', () => {
			const cookieFn = Endpoint.createCookies('');

			const allCookies = cookieFn();

			expect(allCookies).toEqual({});
		});

		it('should decode URL-encoded values in all cookies', () => {
			const cookieFn = Endpoint.createCookies(
				'user=John%20Doe; email=john%40example.com',
			);

			const allCookies = cookieFn();

			expect(allCookies).toEqual({
				user: 'John Doe',
				email: 'john@example.com',
			});
		});

		it('should preserve case in cookie names when getting all', () => {
			const cookieFn = Endpoint.createCookies(
				'Session=abc; session=xyz; TOKEN=123',
			);

			const allCookies = cookieFn();

			expect(allCookies).toEqual({
				Session: 'abc',
				session: 'xyz',
				TOKEN: '123',
			});
		});

		it('should handle cookies with equals sign in values', () => {
			const cookieFn = Endpoint.createCookies(
				'data=key=value; token=abc=123=xyz',
			);

			const allCookies = cookieFn();

			expect(allCookies).toEqual({
				data: 'key=value',
				token: 'abc=123=xyz',
			});
		});

		it('should work with complex real-world cookie string', () => {
			const cookieFn = Endpoint.createCookies(
				'session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9; user_id=12345; preferences=%7B%22theme%22%3A%22dark%22%7D; authenticated=true',
			);

			const allCookies = cookieFn();

			expect(allCookies).toEqual({
				session: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
				user_id: '12345',
				preferences: '{"theme":"dark"}',
				authenticated: 'true',
			});
		});
	});
});
