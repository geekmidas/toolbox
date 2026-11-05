import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { ObjectStorage } from '../aws/ObjectStorage';
import { UnresolvedDependency } from '../errors';
import {
	isServed,
	type ProvisionContext,
	provisionerFor,
	siteEnvironment,
} from '../fromManifest';

const stack = {} as never;

const manifest = {
	Uploads: {
		kind: 'objects',
		id: 'Uploads',
		provides: ['UPLOADS_CONNECTION_STRING'],
	},
	UploadsServer: {
		kind: 'file-server',
		id: 'UploadsServer',
		of: 'Uploads',
		open: ['brand/**'],
		provides: ['UPLOADS_URL'],
	},
	Assets: {
		kind: 'objects',
		id: 'Assets',
		provides: ['ASSETS_CONNECTION_STRING'],
	},
	Api: {
		kind: 'rest-api',
		id: 'Api',
		endpoints: [],
		provides: ['API_URL', 'API_TRUSTED_ORIGINS', 'API_COOKIE_DOMAIN'],
	},
	Orders: { kind: 'database', id: 'Orders', provides: ['ORDERS_URL'] },
	Mailer: {
		kind: 'email',
		id: 'Mailer',
		provides: ['MAILER_URL', 'MAILER_FROM'],
	},
	Console: {
		kind: 'site',
		id: 'Console',
		variant: 'static',
		path: 'apps/console',
		dependencies: [
			{ target: 'Api', kind: 'rest-api' },
			{ target: 'Orders', kind: 'database' },
			{ target: 'UploadsServer', kind: 'file-server' },
			{ target: 'Mailer', kind: 'email' },
		],
		provides: ['CONSOLE_URL'],
	},
} as const satisfies ConstructManifest;

/** A provisioned stand-in that provides whatever it was handed. */
const provided = (values: Record<string, string>) =>
	({ provides: () => values }) as never;

const context = (
	provisioned: Record<string, unknown> = {},
): ProvisionContext => ({
	manifest,
	provisioned: provisioned as never,
	bootstraps: new Map(),
});

describe('isServed', () => {
	it('finds the surface pointing at a bucket', () => {
		// The cost this design named: the bucket alone no longer says whether it
		// is served, so you find whoever points at it.
		expect(isServed('Uploads', manifest)).toBe(true);
	});

	it('leaves an unserved bucket alone', () => {
		expect(isServed('Assets', manifest)).toBe(false);
	});
});

describe('file-server provisioning', () => {
	it('refuses an origin that was not provisioned', () => {
		expect(() =>
			provisionerFor('file-server')(
				stack,
				manifest.UploadsServer,
				{},
				context(),
			),
		).toThrow(UnresolvedDependency);
	});

	it('routes everything at the root, so a served path is a bucket key', () => {
		const origin = new ObjectStorage(stack, 'Uploads');
		const server = provisionerFor('file-server')(
			stack,
			manifest.UploadsServer,
			{},
			context({ Uploads: origin }),
		) as unknown as { routed: { pattern: string }[] };

		expect(server.routed).toEqual([
			{ pattern: '/*', bucket: expect.anything() },
		]);
	});
});

describe('siteEnvironment', () => {
	const built = () =>
		siteEnvironment(
			manifest.Console,
			context({
				Api: provided({ url: 'https://api.example.com' }),
				Orders: provided({ url: 'postgres://user:pw@db/orders' }),
				Uploads: provided({
					connectionString: 's3://uploads-x1?region=eu-west-1',
				}),
				UploadsServer: provided({ url: 'https://files.example.com' }),
				Mailer: provided({
					url: 'smtp://user:pw@email-smtp.example.com:587',
					from: 'hello@shop.test',
				}),
			}),
		);

	it('inlines an address under the name the bundler expects', () => {
		expect(built().VITE_API_URL).toBe('https://api.example.com');
	});

	it('inlines a served bucket’s address, but never the bucket’s own', () => {
		// A served URL is what a browser fetches; the bucket's presigns, and a
		// presigner in a bundle is a credential in a bundle.
		expect(built().VITE_UPLOADS_URL).toBe('https://files.example.com');
		expect(built()).not.toHaveProperty('VITE_UPLOADS_CONNECTION_STRING');
	});

	it("inlines where a served bucket's signed links point", () => {
		expect(built().VITE_UPLOADS_SIGNED_ORIGIN).toBe(
			'https://uploads-x1.s3.eu-west-1.amazonaws.com',
		);
	});

	it("inlines a bucket's served address on an edge to the bucket itself", () => {
		// A full-stack site's `.dependsOn([uploads.server])`: the server half
		// holds the bucket, and the bundle still shows its objects from where
		// they are served.
		const env = siteEnvironment(
			{
				...manifest.Console,
				dependencies: [{ target: 'Uploads', kind: 'objects' }],
			},
			context({
				Uploads: provided({
					connectionString: 's3://uploads-x1?region=eu-west-1',
				}),
				UploadsServer: provided({ url: 'https://files.example.com' }),
			}),
		);

		// And where the bucket's signed links point, derived from its
		// connection — never the connection itself.
		expect(env).toEqual({
			VITE_UPLOADS_SIGNED_ORIGIN:
				'https://uploads-x1.s3.eu-west-1.amazonaws.com',
			VITE_UPLOADS_URL: 'https://files.example.com',
			// Both, as the one list a page's image config reads.
			VITE_GKM_IMAGE_ORIGINS:
				'https://files.example.com,https://uploads-x1.s3.eu-west-1.amazonaws.com',
		});
	});

	it('keeps a connection string out of the bundle entirely', () => {
		// A site may legitimately depend on a database — its server half, where
		// it has one, reads env like anything else. `PUBLIC` decides only what
		// may be *prefixed*, and a password may not.
		expect(built()).not.toHaveProperty('VITE_ORDERS_URL');
	});

	it('has no inbox to share for deployed mail, and never shares the mail URL', () => {
		// The inbox is Mailpit's, and exists only locally: deployed, an app that
		// reads it falls back to the phone's own mail app.
		expect(built()).not.toHaveProperty('VITE_MAILER_INBOX_URL');
		expect(built()).not.toHaveProperty('VITE_MAILER_URL');
	});

	it('fails loudly on an edge nothing provisioned', () => {
		// A smaller environment builds and then fails at runtime against
		// `http:///`, with nothing to point at.
		expect(() =>
			siteEnvironment(manifest.Console, context({ Api: provided({}) })),
		).toThrow(UnresolvedDependency);
	});
});
