import { describe, expect, it } from 'vitest';
import type { ConstructManifest } from '../declaration';
import { bucketExpiry, DEFAULT_DERIVED_DAYS, DERIVED_PREFIX } from '../derived';

const processor = {
	id: 'thumbnails',
	handler: 'thumbnails.handler',
	dependencies: [],
	path: '/i/:width/*',
	prefix: '/i/',
};

/** A bucket, a file server over it, and whatever each is given. */
const manifest = (
	bucket: Record<string, unknown> = {},
	server: Record<string, unknown> = {},
): ConstructManifest =>
	({
		Assets: {
			kind: 'objects',
			id: 'Assets',
			provides: ['ASSETS_URL'],
			...bucket,
		},
		AssetsServer: {
			kind: 'file-server',
			id: 'AssetsServer',
			of: 'Assets',
			open: ['**'],
			provides: ['ASSETS_SERVER_URL'],
			...server,
		},
	}) as unknown as ConstructManifest;

describe('what a bucket expires', () => {
	it('is what it declared, when nothing over it processes', () => {
		expect(bucketExpiry(manifest({ expire: { 'tmp/': 1 } }), 'Assets')).toEqual(
			{ 'tmp/': 1 },
		);
		expect(bucketExpiry(manifest(), 'Assets')).toBeUndefined();
	});

	it("adds its processors' derivatives, for 30 days unless the server says", () => {
		expect(
			bucketExpiry(manifest({}, { processors: [processor] }), 'Assets'),
		).toEqual({ [DERIVED_PREFIX]: DEFAULT_DERIVED_DAYS });
		expect(DEFAULT_DERIVED_DAYS).toBe(30);

		expect(
			bucketExpiry(
				manifest(
					{ expire: { 'tmp/': 1 } },
					{ processors: [processor], derivedDays: 7 },
				),
				'Assets',
			),
		).toEqual({ 'tmp/': 1, [DERIVED_PREFIX]: 7 });
	});

	it('keeps them for the longest any server over it asked', () => {
		const both = {
			...manifest({}, { processors: [processor], derivedDays: 7 }),
			PreviewsServer: {
				kind: 'file-server',
				id: 'PreviewsServer',
				of: 'Assets',
				open: ['**'],
				processors: [processor],
				derivedDays: 90,
				provides: ['PREVIEWS_SERVER_URL'],
			},
		} as unknown as ConstructManifest;

		expect(bucketExpiry(both, 'Assets')).toEqual({ [DERIVED_PREFIX]: 90 });
	});

	it('lets the bucket name the derived prefix itself', () => {
		expect(
			bucketExpiry(
				manifest(
					{ expire: { [DERIVED_PREFIX]: 3 } },
					{ processors: [processor] },
				),
				'Assets',
			),
		).toEqual({ [DERIVED_PREFIX]: 3 });
	});

	it("ignores a server's derived days when it has no processors", () => {
		expect(
			bucketExpiry(manifest({}, { derivedDays: 7 }), 'Assets'),
		).toBeUndefined();
	});
});
