import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { moveBucketKeys } from '../bucketKeys';

const manifest = {
	Assets: {
		kind: 'objects',
		id: 'Assets',
		provides: ['ASSETS_CONNECTION_STRING'],
	},
	AssetsServer: {
		kind: 'file-server',
		id: 'AssetsServer',
		of: 'Assets',
		provides: ['ASSETS_URL'],
	},
	Exports: {
		kind: 'objects',
		id: 'Exports',
		provides: ['EXPORTS_CONNECTION_STRING'],
	},
} as unknown as ConstructManifest;

const connection = 's3://KEY:SECRET@assets-x1?region=eu-west-1';

describe('moveBucketKeys', () => {
	it('moves a bucket connection off <ID>_URL, then the server address onto it', () => {
		const { custom, moved } = moveBucketKeys(manifest, {
			ASSETS_URL: connection,
			ASSETS_SERVER_URL: 'https://assets.example.com',
			EXPORTS_URL: 's3://exports-x1?region=eu-west-1',
			STRIPE_CREDENTIALS: '{}',
		});

		expect(custom).toEqual({
			ASSETS_CONNECTION_STRING: connection,
			ASSETS_URL: 'https://assets.example.com',
			EXPORTS_CONNECTION_STRING: 's3://exports-x1?region=eu-west-1',
			STRIPE_CREDENTIALS: '{}',
		});
		expect(moved).toEqual([
			{ from: 'ASSETS_URL', to: 'ASSETS_CONNECTION_STRING' },
			{ from: 'EXPORTS_URL', to: 'EXPORTS_CONNECTION_STRING' },
			{ from: 'ASSETS_SERVER_URL', to: 'ASSETS_URL' },
		]);
	});

	it('moves nothing on a stage already on the new names', () => {
		const stored = {
			ASSETS_CONNECTION_STRING: connection,
			ASSETS_URL: 'https://assets.example.com',
		};
		const { custom, moved } = moveBucketKeys(manifest, stored);

		expect(custom).toEqual(stored);
		expect(moved).toEqual([]);
	});

	it('leaves an old key whose new name is already set', () => {
		const { custom, moved } = moveBucketKeys(manifest, {
			ASSETS_URL: 's3://old?region=eu-west-1',
			ASSETS_CONNECTION_STRING: connection,
		});

		expect(custom.ASSETS_CONNECTION_STRING).toBe(connection);
		expect(custom.ASSETS_URL).toBe('s3://old?region=eu-west-1');
		expect(moved).toEqual([]);
	});

	it('takes an https value under the bucket id for the server address', () => {
		const { custom, moved } = moveBucketKeys(manifest, {
			ASSETS_URL: 'https://assets.example.com',
		});

		expect(custom).toEqual({ ASSETS_URL: 'https://assets.example.com' });
		expect(moved).toEqual([]);
	});
});
