import { describe, expect, it } from 'vitest';
import { InvalidConstructId } from '../errors';
import {
	canonicalId,
	cloudName,
	cookieDomain,
	environmentCase,
	provideKey,
	serviceKey,
} from '../naming';

describe('environmentCase', () => {
	it.each([
		['sendEmail', 'SEND_EMAIL'],
		['Uploads', 'UPLOADS'],
		['user-uploads', 'USER_UPLOADS'],
		['user_uploads', 'USER_UPLOADS'],
		['api2', 'API2'], // a digit joins the word it follows
		['apiV2', 'API_V2'], // but only when snakecase left it adjacent
	])('%s → %s', (input, expected) => {
		expect(environmentCase(input)).toBe(expected);
	});

	it('agrees across every spelling of one id', () => {
		const spellings = ['uploads', 'Uploads', 'user-uploads', 'user_uploads'];
		const keys = new Set(spellings.map(canonicalId).map(environmentCase));
		// uploads/Uploads → UPLOADS; user-uploads/user_uploads → USER_UPLOADS
		expect(keys).toEqual(new Set(['UPLOADS', 'USER_UPLOADS']));
	});
});

describe('provideKey', () => {
	it.each([
		['Uploads', 'url', 'UPLOADS_URL'],
		['Uploads', 'cdnUrl', 'UPLOADS_CDN_URL'],
		['UserUploads', 'url', 'USER_UPLOADS_URL'],
	])('%s + %s → %s', (id, role, expected) => {
		expect(provideKey(id, role)).toBe(expected);
	});
});

describe('canonicalId', () => {
	it.each([
		['uploads', 'Uploads'],
		['Uploads', 'Uploads'],
		['user_uploads', 'UserUploads'],
		['user-uploads', 'UserUploads'],
		['userUploads', 'UserUploads'],
	])('%s → %s', (input, expected) => {
		expect(canonicalId(input)).toBe(expected);
	});

	it('is idempotent', () => {
		for (const input of ['uploads', 'user-uploads', 'apiV2']) {
			expect(canonicalId(canonicalId(input))).toBe(canonicalId(input));
		}
	});

	it.each([
		['2fa', 'a digit cannot start an identifier'],
		['', 'empty'],
		['---', 'nothing but separators'],
	])('rejects %s (%s)', (input) => {
		expect(() => canonicalId(input)).toThrow(InvalidConstructId);
	});

	it('carries the value rather than interpolating it', () => {
		expect.assertions(3);
		try {
			canonicalId('2fa');
		} catch (error) {
			const e = error as InvalidConstructId;
			expect(e.input).toBe('2fa');
			expect(e.canonical).toBe('2Fa');
			expect(e.message).toMatch(/must start with a letter/);
		}
	});

	it('collapses spellings of the same id to one', () => {
		const ids = ['uploads', 'Uploads', 'UPLOADS'].map(canonicalId);
		expect(new Set(ids).size).toBe(1);
	});
});

describe('cloudName', () => {
	const scope = { stage: 'prod', app: 'myapp' };

	it.each([
		['UserUploads', 'prod-myapp-user-uploads'],
		['Uploads', 'prod-myapp-uploads'],
	])('%s → %s', (id, expected) => {
		expect(cloudName(scope, id)).toBe(expected);
	});

	it('is lowercase and hyphenated, which S3 and DNS both require', () => {
		expect(cloudName(scope, 'UserUploads')).toMatch(/^[a-z0-9-]+$/);
	});
});

describe('serviceKey', () => {
	it.each([
		['Uploads', 'uploads'],
		['UserUploads', 'userUploads'],
		['API', 'aPI'], // matches Uncapitalize, which only lowers the first char
	])('%s → %s', (id, expected) => {
		expect(serviceKey(id)).toBe(expected);
	});

	it('agrees with Uncapitalize, which is what types it', () => {
		// If these diverge, services.<key> is typed as one thing and populated as
		// another — the failure this pairing exists to prevent.
		const id = 'UserUploads' as const;
		const typed: Uncapitalize<typeof id> = 'userUploads';
		expect(serviceKey(id)).toBe(typed);
	});
});

describe('cookieDomain', () => {
	it('scopes a cookie to the domain a surface and its callers share', () => {
		expect(
			cookieDomain(['https://api.example.com', 'https://console.example.com']),
		).toBe('.example.com');
	});

	it('scopes nothing across one host', () => {
		// Local development: cookies ignore the port, so there is nothing for a
		// Domain to widen — and `.localhost` is not one a browser accepts.
		expect(
			cookieDomain(['http://localhost:3000', 'http://localhost:5173']),
		).toBeUndefined();
	});

	it('scopes nothing across unrelated hosts', () => {
		// Two registrable domains cannot share a cookie at all, and emitting
		// their longest common suffix would set a value that silently fails.
		expect(
			cookieDomain(['https://api.example.com', 'https://console.other.com']),
		).toBeUndefined();
	});

	it('refuses a bare TLD', () => {
		// `.com` is one shared label, which is a suffix and not a domain.
		expect(
			cookieDomain(['https://example.com', 'https://other.com']),
		).toBeUndefined();
	});

	it('scopes nothing across IP addresses', () => {
		expect(
			cookieDomain(['http://127.0.0.1:3000', 'http://127.0.0.1:5173']),
		).toBeUndefined();
	});

	it('goes as deep as the addresses agree', () => {
		expect(
			cookieDomain(['https://a.eu.example.com', 'https://b.eu.example.com']),
		).toBe('.eu.example.com');
	});
});
