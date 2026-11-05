import type { ConstructManifest } from '@geekmidas/manifest';
import { assertDerivations, UnknownParent } from '@geekmidas/manifest';
import { registerStorageDriver } from '@geekmidas/storage';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	FileServer,
	FileServerReadOnly,
	ImmutableNotOpen,
	NotOpen,
} from '../file-server';
import { MobileApp } from '../mobile-app';
import { ObjectStorage } from '../object-storage';
import { StaticSite } from '../site';
import { Telemetry } from '../telemetry';

/** A driver that records the URL it was built from and nothing else. */
const fakeDriver = {
	scheme: 'fake:',
	create: (url: string) =>
		({
			url,
			getDownloadURL: async (file: { path: string }, expiresIn?: number) =>
				`fake-signed:${file.path}:${expiresIn ?? ''}`,
		}) as never,
};

/** An env parser that answers from a plain record. */
const parserFor = (values: Record<string, string>) =>
	({
		create(build: (get: (key: string) => any) => Record<string, unknown>) {
			const shape = build((key) => ({
				string: () => {
					const spec = { __key: key, optional: () => spec };
					return spec;
				},
			}));

			return {
				parse: () =>
					Object.fromEntries(
						Object.entries(shape).map(([field, spec]) => [
							field,
							values[(spec as { __key: string }).__key],
						]),
					),
			};
		},
	}) as never;

const uploads = new FileServer('Uploads', {
	open: ['brand/**', 'avatars/*.png'],
});

const client = () =>
	uploads.service.register({
		envParser: parserFor({
			UPLOADS_CONNECTION_STRING: 'fake://uploads',
			UPLOADS_URL: 'https://files.example.com/',
		}),
	} as never);

beforeAll(() => registerStorageDriver(fakeDriver));

describe('FileServer', () => {
	it('vends its bucket and the surface over it', () => {
		// The id names the bucket. Serving a bucket you already have then *adds*
		// a node rather than renaming the one holding the data.
		expect(uploads.declare()).toEqual([
			{
				kind: 'objects',
				id: 'Uploads',
				provides: ['UPLOADS_CONNECTION_STRING'],
			},
			{
				kind: 'file-server',
				id: 'UploadsServer',
				of: 'Uploads',
				open: ['brand/**', 'avatars/*.png'],
				provides: ['UPLOADS_URL'],
			},
		]);
	});

	it('declares only a surface over a bucket it was given', () => {
		const bucket = new ObjectStorage('Assets');
		const files = new FileServer('Files', { origin: bucket });

		expect(files.declare()).toEqual([
			{
				kind: 'file-server',
				id: 'FilesServer',
				of: 'Assets',
				provides: ['FILES_URL'],
			},
		]);
	});

	it('resolves its origin, or fails the build', () => {
		const orphan = Object.fromEntries(
			new FileServer('Files', {
				origin: { id: 'Missing', declare: () => [] },
			})
				.declare()
				.map((d) => [d.id, d]),
		) as ConstructManifest;

		expect(() => assertDerivations(orphan)).toThrow(UnknownParent);
	});

	it('serves an open path without a signature', async () => {
		const files = await client();

		expect(files.url('brand/logo.png')).toBe(
			'https://files.example.com/brand/logo.png',
		);
	});

	it('refuses to mint an unsigned URL for a private object', async () => {
		const files = await client();

		// The type already refuses it; a JavaScript caller gets no compiler, and
		// this is a leak rather than a mistake.
		expect(() => files.openUrl('invoices/7.pdf')).toThrow(NotOpen);
	});

	it('stops a single star at a segment boundary', async () => {
		const files = await client();

		expect(files.openUrl('avatars/me.png')).toContain('avatars/me.png');
		expect(() => files.openUrl('avatars/2024/me.png')).toThrow(NotOpen);
	});

	it('lets a double star cross one', async () => {
		const files = await client();

		expect(files.openUrl('brand/dark/logo.png')).toContain('dark/logo.png');
	});

	it('signs anything, open or not', async () => {
		// Uploading to an open path is ordinary, and so is signing one. The only
		// asymmetry worth enforcing is the unsigned URL.
		const files = await client();

		await expect(files.signedUrl('invoices/7.pdf', 15)).resolves.toBe(
			'fake-signed:invoices/7.pdf:15',
		);
	});

	it('keeps the bucket half of the client', async () => {
		// A superset, made literal: anything taking `services.uploads` keeps
		// compiling when the construct behind it grows a serving half.
		const files = await client();

		expect(typeof files.getDownloadURL).toBe('function');
	});
});

describe('FileServer immutable paths', () => {
	it('declares the open paths the edge keeps forever', () => {
		const assets = new FileServer('Assets', {
			open: ['brand/**', 'avatars/*.png'],
			immutable: ['brand/logos/*', 'avatars/*.png'],
		});

		expect(assets.declare()[1]).toMatchObject({
			kind: 'file-server',
			immutable: ['brand/logos/*', 'avatars/*.png'],
		});
	});

	it('declares none unless asked', () => {
		expect(uploads.declare()[1]).not.toHaveProperty('immutable');
	});

	it('refuses a pattern no open path admits: the edge serves only those', () => {
		const make = (immutable: string[]) => () =>
			new FileServer('Assets', { open: ['brand/**', 'avatars/*'], immutable });

		// Wider than what is open, or outside it altogether.
		expect(make(['**'])).toThrow(ImmutableNotOpen);
		expect(make(['avatars/**'])).toThrow(ImmutableNotOpen);
		expect(make(['invoices/*'])).toThrow(/'invoices\/\*' is immutable/);
		expect(() => new FileServer('Assets', { immutable: ['brand/*'] })).toThrow(
			/opens none/,
		);
		// Narrower, or the same.
		expect(make(['brand/**', 'brand/2026/*.png', 'avatars/*'])).not.toThrow();
	});
});

describe('FileServer telemetry', () => {
	it('declares the node its processor unit emits through', () => {
		const telemetry = new Telemetry('Telemetry');
		const surface = (files: FileServer) =>
			files.declare().find((d) => d.kind === 'file-server');

		expect(
			surface(new FileServer('Assets', { open: ['**'], telemetry })),
		).toMatchObject({ telemetry: 'Telemetry' });
		expect(surface(new FileServer('Assets'))).not.toHaveProperty('telemetry');
	});
});

describe('FileServer.publicFace', () => {
	it('is the surface, whose address is public', () => {
		expect(uploads.publicFace.id).toBe('UploadsServer');
		expect(uploads.publicFace.declare()).toEqual([
			{
				kind: 'file-server',
				id: 'UploadsServer',
				of: 'Uploads',
				open: ['brand/**', 'avatars/*.png'],
				provides: ['UPLOADS_URL'],
			},
		]);
	});

	it("is what a site's and an app's plain edge points at", () => {
		const web = new StaticSite('Web', { path: 'apps/web' }).dependsOn([
			uploads,
		]);
		const app = new MobileApp('App', { path: 'apps/app' }).dependsOn([uploads]);

		const edge = { target: 'UploadsServer', kind: 'file-server' };
		expect(web.declare()[0]).toMatchObject({ dependencies: [edge] });
		expect(app.declare()[0]).toMatchObject({ dependencies: [edge] });
	});
});

describe('FileServer.server', () => {
	it('is the bucket: what a frontend asks for when its server half writes', () => {
		const web = new StaticSite('Web', { path: 'apps/web' }).dependsOn([
			uploads.server,
		]);

		expect(uploads.server.id).toBe('Uploads');
		expect(web.declare()[0]).toMatchObject({
			dependencies: [{ target: 'Uploads', kind: 'objects' }],
		});
	});

	it('is the bucket it was given, for a server over another construct', () => {
		const files = new ObjectStorage('Files');
		const cdn = new FileServer('Cdn', { origin: files });

		expect(cdn.server.id).toBe('Files');
		expect(cdn.publicFace.id).toBe('CdnServer');
		expect(
			new StaticSite('Web', { path: 'apps/web' })
				.dependsOn([cdn.server])
				.declare()[0],
		).toMatchObject({ dependencies: [{ target: 'Files', kind: 'objects' }] });
	});
});

describe('a file server reached through its public face', () => {
	const served = () =>
		uploads.service.register({
			envParser: parserFor({ UPLOADS_URL: 'https://files.example.com/' }),
		} as never);

	it('serves', async () => {
		expect((await served()).url('brand/logo.png')).toBe(
			'https://files.example.com/brand/logo.png',
		);
	});

	it('refuses everything that needs the bucket, naming the edge that has it', async () => {
		const client = await served();

		expect(() =>
			client.getUploadURL({ path: 'a.png', contentType: 'image/png' }),
		).toThrow(FileServerReadOnly);
		await expect(async () =>
			client.signedUrl('invoices/7.pdf'),
		).rejects.toThrow(/uploads\.server/);
	});
});
