import { describe, expect, it } from 'vitest';
import {
	CACHING_OPTIMIZED,
	cdnHost,
	cdnName,
	distributionConfig,
	headersPolicyConfig,
	holds,
	IMMUTABLE_CACHE_CONTROL,
	pathPattern,
	sameHeadersPolicy,
} from '../s3/cdn';

describe('names', () => {
	it('answers on <fileserver>.<domain>', () => {
		expect(cdnHost('UploadsServer', 'Shop.Example.com')).toBe(
			'uploads-server.shop.example.com',
		);
	});

	it('keeps a name whole where it fits, and shortens a long one by a hash of it', () => {
		expect(cdnName('shop', 'prod', 'UploadsServer')).toBe(
			'gkm-shop-prod-uploads-server',
		);
		const long = cdnName(
			'a-very-long-project-scope-name',
			'production',
			'BrandAssetsServer',
		);
		const other = cdnName(
			'a-very-long-project-scope-name',
			'production',
			'BrandAssetsServer2',
		);
		expect(long.length).toBeLessThanOrEqual(64);
		expect(long).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(long).not.toBe(other);
	});

	it('reads a glob as a CloudFront path pattern, whose star crosses /', () => {
		expect(pathPattern('/brand/**')).toBe('brand/*');
		expect(pathPattern('avatars/*.png')).toBe('avatars/*.png');
	});
});

describe('response headers policies', () => {
	it('allows GET from the stage’s sites, and nothing more, with no forever header', () => {
		const config = headersPolicyConfig({
			name: 'n-cors',
			comment: 'c',
			origins: ['https://b.example.com', 'https://a.example.com'],
			immutable: false,
		});

		expect(config.CorsConfig?.AccessControlAllowOrigins.Items).toEqual([
			'https://a.example.com',
			'https://b.example.com',
		]);
		expect(config.CorsConfig?.AccessControlAllowMethods.Items).toEqual([
			'GET',
			'HEAD',
			'OPTIONS',
		]);
		expect(config.CorsConfig?.AccessControlAllowCredentials).toBe(false);
		expect(config.CustomHeadersConfig).toBeUndefined();
	});

	it('sends the forever header over the origin’s on an immutable path', () => {
		const config = headersPolicyConfig({
			name: 'n-immutable',
			comment: 'c',
			origins: [],
			immutable: true,
		});

		expect(config.CorsConfig).toBeUndefined();
		expect(config.CustomHeadersConfig?.Items).toEqual([
			{
				Header: 'Cache-Control',
				Value: IMMUTABLE_CACHE_CONTROL,
				Override: true,
			},
		]);
	});

	it('is drift when anything is missing, or something it never sets is added', () => {
		const wanted = headersPolicyConfig({
			name: 'n',
			comment: 'c',
			origins: ['https://a.example.com'],
			immutable: true,
		});

		expect(sameHeadersPolicy(structuredClone(wanted), wanted)).toBe(true);
		expect(sameHeadersPolicy(undefined, wanted)).toBe(false);
		expect(
			sameHeadersPolicy(
				{
					...structuredClone(wanted),
					CustomHeadersConfig: {
						Quantity: 1,
						Items: [
							{ Header: 'Cache-Control', Value: 'no-store', Override: true },
						],
					},
				},
				wanted,
			),
		).toBe(false);
		expect(
			sameHeadersPolicy(
				{
					...structuredClone(wanted),
					SecurityHeadersConfig: {
						FrameOptions: { FrameOption: 'DENY', Override: true },
					},
				} as never,
				wanted,
			),
		).toBe(false);
	});
});

describe('the distribution', () => {
	const config = distributionConfig({
		comment: 'gkm shop prod UploadsServer',
		callerReference: 'gkm-shop-prod-uploads-server',
		host: 'uploads-server.shop.example.com',
		certificateArn: 'arn:aws:acm:us-east-1:111:certificate/c',
		bucketDomain: 'shop-prod-uploads.s3.eu-west-1.amazonaws.com',
		originAccessControlId: 'OAC',
		corsPolicyId: 'CORS',
		immutablePolicyId: 'IMM',
		immutable: ['brand/logos/**', 'brand/icons/*'],
	});

	it('answers on its name over HTTPS, with its certificate, reading the bucket through the origin access control', () => {
		expect(config.Aliases).toEqual({
			Quantity: 1,
			Items: ['uploads-server.shop.example.com'],
		});
		expect(config.ViewerCertificate).toMatchObject({
			ACMCertificateArn: 'arn:aws:acm:us-east-1:111:certificate/c',
			SSLSupportMethod: 'sni-only',
			CloudFrontDefaultCertificate: false,
		});
		expect(config.Origins?.Items?.[0]).toMatchObject({
			DomainName: 'shop-prod-uploads.s3.eu-west-1.amazonaws.com',
			OriginAccessControlId: 'OAC',
			S3OriginConfig: { OriginAccessIdentity: '' },
		});
	});

	it('caches on the path alone, compressed — CORS everywhere, the forever header on immutable paths', () => {
		expect(config.DefaultCacheBehavior).toMatchObject({
			ViewerProtocolPolicy: 'redirect-to-https',
			Compress: true,
			CachePolicyId: CACHING_OPTIMIZED,
			ResponseHeadersPolicyId: 'CORS',
		});
		expect(config.DefaultCacheBehavior?.AllowedMethods?.Items).toEqual([
			'GET',
			'HEAD',
			'OPTIONS',
		]);
		expect(config.CacheBehaviors?.Items?.map((b) => b.PathPattern)).toEqual([
			'brand/icons/*',
			'brand/logos/*',
		]);
		expect(
			config.CacheBehaviors?.Items?.every(
				(b) => b.ResponseHeadersPolicyId === 'IMM',
			),
		).toBe(true);
	});

	it('holds what it wants inside a config AWS filled with its defaults, and nothing else counts', () => {
		const filled = {
			...structuredClone(config),
			CallerReference: 'set-when-created',
			PriceClass: 'PriceClass_100',
			Logging: {
				Enabled: true,
				Bucket: 'logs',
				Prefix: '',
				IncludeCookies: false,
			},
			DefaultCacheBehavior: {
				...structuredClone(config.DefaultCacheBehavior),
				SmoothStreaming: false,
			},
			CacheBehaviors: {
				Quantity: 2,
				Items: [...structuredClone(config.CacheBehaviors!.Items!)].reverse(),
			},
		};

		expect(holds(filled, config)).toBe(true);
		expect(
			holds(
				{
					...filled,
					DefaultCacheBehavior: {
						...filled.DefaultCacheBehavior,
						Compress: false,
					},
				},
				config,
			),
		).toBe(false);
		expect(holds({ ...filled, Aliases: { Quantity: 0 } }, config)).toBe(false);
	});
});
