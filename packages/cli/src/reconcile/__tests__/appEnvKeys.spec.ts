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
		auth: { target: 'Auth', kind: 'rest-api' },
		endpoints: [
			{
				id: 'ApiPOST/uploads',
				handler: 'endpoints/uploads.ts#createUploadUrl',
				method: 'POST',
				path: '/uploads',
				dependencies: [{ target: 'Uploads', kind: 'objects' }],
			},
		],
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

describe('appEnvKeys', () => {
	it('gives a caller of the auth server its URL, and none of its own keys', () => {
		const keys = appEnvKeys(manifest, 'api')!;

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
		const keys = appEnvKeys(manifest, 'auth')!;

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
		const keys = appEnvKeys(manifest, 'api')!;

		expect(keys).toContain('UPLOADS_URL');
		expect(keys).toContain('UPLOADS_SERVER_URL');
	});
});

describe('an edge to a WebSocket surface', () => {
	const sockets = {
		Realtime: {
			kind: 'websocket-api',
			id: 'Realtime',
			path: 'apps/realtime',
			provides: [
				'REALTIME_URL',
				'REALTIME_TRUSTED_ORIGINS',
				'REALTIME_PUBLISHER_CONNECTION_STRING',
			],
		},
		Api: {
			kind: 'rest-api',
			id: 'Api',
			path: 'apps/api',
			endpoints: [
				{
					id: 'ApiPOST/notify',
					handler: 'endpoints/notify.ts#notify',
					method: 'POST',
					path: '/notify',
					dependencies: [{ target: 'Realtime', kind: 'websocket-api' }],
				},
			],
			provides: ['API_URL'],
		},
		Web: {
			kind: 'site',
			id: 'Web',
			variant: 'vite',
			app: { path: 'apps/web' },
			dependencies: [{ target: 'Realtime', kind: 'websocket-api' }],
			provides: ['WEB_URL'],
		},
	} as unknown as ConstructManifest;

	it('hands a server its address and its publisher', () => {
		const keys = appEnvKeys(sockets, 'api')!;

		expect(keys).toContain('REALTIME_URL');
		expect(keys).toContain('REALTIME_PUBLISHER_CONNECTION_STRING');
		expect(keys).not.toContain('REALTIME_TRUSTED_ORIGINS');
	});

	it('hands a site its address alone: the publisher writes to every socket', () => {
		const keys = appEnvKeys(sockets, 'web')!;

		expect(keys).toContain('REALTIME_URL');
		expect(keys).not.toContain('REALTIME_PUBLISHER_CONNECTION_STRING');
	});

	it('hands the surface its own keys', () => {
		const keys = appEnvKeys(sockets, 'realtime')!;

		expect([...keys].sort()).toEqual([
			'REALTIME_PUBLISHER_CONNECTION_STRING',
			'REALTIME_TRUSTED_ORIGINS',
			'REALTIME_URL',
		]);
	});
});
