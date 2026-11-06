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
	Uploads: {
		kind: 'objects',
		id: 'Uploads',
		provides: ['UPLOADS_CONNECTION_STRING'],
	},
	UploadsServer: {
		kind: 'file-server',
		id: 'UploadsServer',
		of: 'Uploads',
		provides: ['UPLOADS_URL'],
	},
	// A site that only shows the objects: its plain edge is to the surface.
	Web: {
		kind: 'site',
		id: 'Web',
		variant: 'next',
		app: { path: 'apps/web' },
		dependencies: [{ target: 'UploadsServer', kind: 'file-server' }],
		provides: ['WEB_URL'],
	},
	// A full-stack site whose server half uploads: `uploads.server`.
	Shop: {
		kind: 'site',
		id: 'Shop',
		variant: 'next',
		app: { path: 'apps/shop' },
		dependencies: [{ target: 'Uploads', kind: 'objects', server: true }],
		provides: ['SHOP_URL'],
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

		expect(keys).toContain('UPLOADS_CONNECTION_STRING');
		expect(keys).toContain('UPLOADS_URL');
		expect(keys).toContain('AWS_ACCESS_KEY_ID');
	});

	it("gives a site's plain edge the served address, and nothing that writes", () => {
		const keys = appEnvKeys(manifest, 'web')!;

		expect(keys).toContain('UPLOADS_URL');
		expect(keys).not.toContain('UPLOADS_CONNECTION_STRING');
		expect(keys).not.toContain('AWS_ACCESS_KEY_ID');
		expect(keys).not.toContain('AWS_SECRET_ACCESS_KEY');
	});

	it("gives a site's edge to the bucket the bucket too, for its server half", () => {
		const keys = appEnvKeys(manifest, 'shop')!;

		expect(keys).toContain('UPLOADS_CONNECTION_STRING');
		expect(keys).toContain('UPLOADS_URL');
		expect(keys).toContain('AWS_ACCESS_KEY_ID');
	});
});

describe('an edge to an ObjectStorage', () => {
	const buckets = {
		Documents: {
			kind: 'objects',
			id: 'Documents',
			provides: ['DOCUMENTS_CONNECTION_STRING'],
		},
		Api: {
			kind: 'rest-api',
			id: 'Api',
			path: 'apps/api',
			endpoints: [
				{
					id: 'ApiGET/documents',
					handler: 'endpoints/documents.ts#list',
					method: 'GET',
					path: '/documents',
					dependencies: [{ target: 'Documents', kind: 'objects' }],
				},
			],
			provides: ['API_URL'],
		},
		// Shows the presigned links the API mints: `.dependsOn([documents])`.
		Web: {
			kind: 'site',
			id: 'Web',
			variant: 'next',
			app: { path: 'apps/web' },
			dependencies: [{ target: 'Documents', kind: 'objects' }],
			provides: ['WEB_URL'],
		},
		App: {
			kind: 'mobile-app',
			id: 'App',
			variant: 'expo',
			app: { path: 'apps/app' },
			dependencies: [{ target: 'Documents', kind: 'objects' }],
			provides: ['APP_SCHEME'],
		},
		// Uploads from its server half: `.dependsOn([documents.server])`.
		Admin: {
			kind: 'site',
			id: 'Admin',
			variant: 'next',
			app: { path: 'apps/admin' },
			dependencies: [{ target: 'Documents', kind: 'objects', server: true }],
			provides: ['ADMIN_URL'],
		},
	} as unknown as ConstructManifest;

	const writes = [
		'DOCUMENTS_CONNECTION_STRING',
		'AWS_ACCESS_KEY_ID',
		'AWS_SECRET_ACCESS_KEY',
		'AWS_REGION',
	];

	it("gives a site's plain edge the signed origin, and nothing that writes", () => {
		const keys = appEnvKeys(buckets, 'web')!;

		expect(keys).toContain('DOCUMENTS_SIGNED_ORIGIN');
		expect(keys).toContain('NEXT_PUBLIC_DOCUMENTS_SIGNED_ORIGIN');
		for (const key of writes) expect(keys).not.toContain(key);
	});

	it("gives a mobile app's plain edge the signed origin, and nothing that writes", () => {
		const keys = appEnvKeys(buckets, 'app')!;

		expect(keys).toContain('EXPO_PUBLIC_DOCUMENTS_SIGNED_ORIGIN');
		for (const key of writes) expect(keys).not.toContain(key);
	});

	it("gives a site's .server edge the connection, the key pair and the signed origin", () => {
		const keys = appEnvKeys(buckets, 'admin')!;

		for (const key of writes) expect(keys).toContain(key);
		expect(keys).toContain('DOCUMENTS_SIGNED_ORIGIN');
		expect(keys).toContain('NEXT_PUBLIC_DOCUMENTS_SIGNED_ORIGIN');
		expect(keys).not.toContain('NEXT_PUBLIC_DOCUMENTS_CONNECTION_STRING');
	});

	it("leaves a backend's plain edge the full one", () => {
		const keys = appEnvKeys(buckets, 'api')!;

		for (const key of writes) expect(keys).toContain(key);
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

	it('hands the surface its own keys, and the site that opens it', () => {
		const keys = appEnvKeys(sockets, 'realtime')!;

		expect([...keys].sort()).toEqual([
			'REALTIME_PUBLISHER_CONNECTION_STRING',
			'REALTIME_TRUSTED_ORIGINS',
			'REALTIME_URL',
			'WEB_URL',
		]);
	});
});

describe("the caller's identity, along the edge", () => {
	/**
	 * The issue's workspace: a phone app and a site that call one API, a
	 * second phone app beside them, and an auth server the API calls.
	 */
	const clients = {
		Api: {
			kind: 'rest-api',
			id: 'Api',
			path: 'apps/api',
			auth: { target: 'Auth', kind: 'rest-api' },
			endpoints: [],
			provides: ['API_URL', 'API_TRUSTED_ORIGINS', 'API_COOKIE_DOMAIN'],
		},
		Auth: {
			kind: 'rest-api',
			id: 'Auth',
			path: 'apps/auth',
			endpoints: [],
			provides: ['AUTH_URL', 'AUTH_TRUSTED_ORIGINS', 'AUTH_COOKIE_DOMAIN'],
		},
		App: {
			kind: 'mobile-app',
			id: 'App',
			variant: 'expo',
			app: { path: 'apps/app' },
			dependencies: [
				{ target: 'Api', kind: 'rest-api' },
				{ target: 'Auth', kind: 'rest-api' },
			],
			provides: ['APP_SCHEME'],
		},
		AdminApp: {
			kind: 'mobile-app',
			id: 'AdminApp',
			variant: 'expo',
			app: { path: 'apps/admin-app' },
			dependencies: [{ target: 'Api', kind: 'rest-api' }],
			provides: ['ADMIN_APP_SCHEME'],
		},
		Web: {
			kind: 'site',
			id: 'Web',
			variant: 'static',
			app: { path: 'apps/web' },
			dependencies: [{ target: 'Api', kind: 'rest-api' }],
			provides: ['WEB_URL'],
		},
	} as unknown as ConstructManifest;

	it("gives the API each phone app's scheme, by the app's own id", () => {
		const keys = appEnvKeys(clients, 'api')!;

		expect(keys).toContain('APP_SCHEME');
		expect(keys).toContain('ADMIN_APP_SCHEME');
	});

	it("gives the API the site's address, to link and redirect back to", () => {
		expect(appEnvKeys(clients, 'api')).toContain('WEB_URL');
	});

	it('gives the auth server only the clients that call it', () => {
		const keys = appEnvKeys(clients, 'auth')!;

		expect(keys).toContain('APP_SCHEME');
		expect(keys).not.toContain('ADMIN_APP_SCHEME');
		expect(keys).not.toContain('WEB_URL');
		// A surface that calls it is something it answers, not somewhere it
		// sends a user.
		expect(keys).not.toContain('API_URL');
	});

	it('still gives the caller the address it calls, and nothing back', () => {
		const app = appEnvKeys(clients, 'app')!;

		expect(app).toContain('API_URL');
		expect(app).toContain('EXPO_PUBLIC_API_URL');
		expect(app).not.toContain('ADMIN_APP_SCHEME');
		expect(app).not.toContain('WEB_URL');
	});
});
