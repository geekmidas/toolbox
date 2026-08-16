import { describe, expect, it } from 'vitest';
import { canonicalId, cloudName, environmentCase, provideKey } from '../naming';

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
