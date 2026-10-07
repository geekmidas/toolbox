import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { appEnvKeys } from '../apps';

/**
 * An API that calls an auth server and signs uploads to a file server's
 * bucket — the edges whose keys an API's environment is built from.
 */
const manifest = {
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: 'apps/api',
		endpoints: [],
		provides: ['API_URL', 'API_TRUSTED_ORIGINS', 'API_COOKIE_DOMAIN'],
	},
	AuthSecret: { kind: 'secret', id: 'AuthSecret', provides: ['AUTH_SECRET'] },
	AuthDb: { kind: 'database', id: 'AuthDb', provides: ['AUTH_DB_URL'] },
	Mail: { kind: 'mail', id: 'Mail', provides: ['MAIL_URL', 'MAIL_FROM'] },
	Auth: {
		kind: 'rest-api',
		id: 'Auth',
		path: 'apps/auth',
		provides: ['AUTH_URL', 'AUTH_TRUSTED_ORIGINS', 'AUTH_COOKIE_DOMAIN'],
		endpoints: [
			{
				id: 'AuthHandler',
				handler: 'Auth.handler',
				method: 'ANY',
				path: '/api/auth/*',
				dependencies: [
					{ target: 'AuthDb', kind: 'database' },
					{ target: 'Mail', kind: 'mail' },
				],
				requires: ['AUTH_SECRET'],
			},
		],
	},
	Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
	UploadsServer: {
		kind: 'file-server',
		id: 'UploadsServer',
		of: 'Uploads',
		provides: ['UPLOADS_SERVER_URL'],
	},
} as unknown as ConstructManifest;

const runnables = { Api: ['Auth', 'Uploads'] };

describe('appEnvKeys', () => {
	it('gives a caller of the auth server its URL, and none of its own keys', () => {
		const keys = appEnvKeys(manifest, 'api', runnables)!;

		expect(keys).toContain('AUTH_URL');
		for (const key of [
			'AUTH_SECRET',
			'AUTH_DB_URL',
			'MAIL_URL',
			'MAIL_FROM',
			'AUTH_TRUSTED_ORIGINS',
			'AUTH_COOKIE_DOMAIN',
		]) {
			expect(keys).not.toContain(key);
		}
	});

	it('gives the auth app its secret, its tenant and its mailer', () => {
		const keys = appEnvKeys(manifest, 'auth', runnables)!;

		expect([...keys].sort()).toEqual([
			'AUTH_COOKIE_DOMAIN',
			'AUTH_DB_URL',
			'AUTH_SECRET',
			'AUTH_TRUSTED_ORIGINS',
			'AUTH_URL',
			'MAIL_FROM',
			'MAIL_URL',
		]);
	});

	it('gives a caller of a file server’s bucket the address that serves it', () => {
		const keys = appEnvKeys(manifest, 'api', runnables)!;

		expect(keys).toContain('UPLOADS_URL');
		expect(keys).toContain('UPLOADS_SERVER_URL');
	});
});
