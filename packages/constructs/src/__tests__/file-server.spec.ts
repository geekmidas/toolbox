import type { ConstructManifest } from '@geekmidas/manifest';
import { assertDerivations, UnknownParent } from '@geekmidas/manifest';
import { registerStorageDriver } from '@geekmidas/storage';
import { beforeAll, describe, expect, it } from 'vitest';
import { FileServer, NotOpen } from '../file-server';
import { ObjectStorage } from '../object-storage';

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
				string: () => ({ __key: key }),
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
			UPLOADS_URL: 'fake://uploads',
			UPLOADS_SERVER_URL: 'https://files.example.com/',
		}),
	} as never);

beforeAll(() => registerStorageDriver(fakeDriver));

describe('FileServer', () => {
	it('vends its bucket and the surface over it', () => {
		// The id names the bucket. Serving a bucket you already have then *adds*
		// a node rather than renaming the one holding the data.
		expect(uploads.declare()).toEqual([
			{ kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
			{
				kind: 'file-server',
				id: 'UploadsServer',
				of: 'Uploads',
				open: ['brand/**', 'avatars/*.png'],
				provides: ['UPLOADS_SERVER_URL'],
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
				provides: ['FILES_SERVER_URL'],
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

describe('FileServer.server', () => {
	it('points an edge at the surface rather than the bucket', () => {
		// Depending on the file server itself points at the *bucket*, which is
		// right for a handler that presigns — and useless to a site, because a
		// bucket's URL is never public and so is never inlined.
		expect(uploads.server.id).toBe('UploadsServer');
		expect(uploads.server.declare()).toEqual([
			{
				kind: 'file-server',
				id: 'UploadsServer',
				of: 'Uploads',
				open: ['brand/**', 'avatars/*.png'],
				provides: ['UPLOADS_SERVER_URL'],
			},
		]);
	});

	it('is the half that is safe to ship', () => {
		// `PUBLIC` is what draws the line: a served address may be prefixed into
		// a bundle, a presigning one may not.
		const bucket = uploads.declare().find((d) => d.kind === 'objects');

		expect(bucket?.provides).toEqual(['UPLOADS_URL']);
		expect(uploads.server.declare()[0]?.provides).toEqual([
			'UPLOADS_SERVER_URL',
		]);
	});
});
