import { describe, expect, it } from 'vitest';
import { imageRemotePatterns } from '../next';

describe('imageRemotePatterns', () => {
	it('is one pattern per origin gkm handed the site', () => {
		expect(
			imageRemotePatterns({
				NEXT_PUBLIC_GKM_IMAGE_ORIGINS:
					'https://acme-assets.s3.eu-west-1.amazonaws.com,https://assets.example.com',
			}),
		).toEqual([
			{
				protocol: 'https',
				hostname: 'acme-assets.s3.eu-west-1.amazonaws.com',
				pathname: '/**',
			},
			{ protocol: 'https', hostname: 'assets.example.com', pathname: '/**' },
		]);
	});

	it("keeps the port a local origin is on: MinIO's, the local edge's", () => {
		expect(
			imageRemotePatterns({
				NEXT_PUBLIC_GKM_IMAGE_ORIGINS:
					'http://192.168.1.5:9010,https://assets.shop.localhost:8443',
			}),
		).toEqual([
			{
				protocol: 'http',
				hostname: '192.168.1.5',
				port: '9010',
				pathname: '/**',
			},
			{
				protocol: 'https',
				hostname: 'assets.shop.localhost',
				port: '8443',
				pathname: '/**',
			},
		]);
	});

	it('reads the unprefixed key where a server half was handed that', () => {
		expect(
			imageRemotePatterns({ GKM_IMAGE_ORIGINS: 'https://a.example.com' }),
		).toHaveLength(1);
	});

	it('is empty, not an error, where gkm handed the site nothing', () => {
		expect(imageRemotePatterns({})).toEqual([]);
		expect(
			imageRemotePatterns({ NEXT_PUBLIC_GKM_IMAGE_ORIGINS: 'not a url,' }),
		).toEqual([]);
	});
});
