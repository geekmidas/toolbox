import { describe, expect, it } from 'vitest';
import { plannedSignedOrigin } from '../s3/plannedOrigin';

const input = {
	workspace: {},
	stage: 'production',
	scope: 'shop',
	config: { provider: 's3' as const, region: 'eu-west-1' },
	bucket: 'Uploads',
};

describe("a bucket's planned signed origin", () => {
	it("is the regional endpoint of the name the bucket's first deploy gives it", () => {
		expect(plannedSignedOrigin(input, {})).toBe(
			'https://shop-production-uploads.s3.eu-west-1.amazonaws.com',
		);
	});

	it("names the region as the provider does: the secrets store's, then AWS_REGION", () => {
		const config = { provider: 's3' as const };
		expect(
			plannedSignedOrigin(
				{
					...input,
					config,
					workspace: {
						secrets: {
							enabled: true,
							store: { provider: 's3', region: 'af-south-1' },
						},
					} as never,
				},
				{ AWS_REGION: 'us-east-1' },
			),
		).toBe('https://shop-production-uploads.s3.af-south-1.amazonaws.com');
		expect(
			plannedSignedOrigin({ ...input, config }, { AWS_REGION: 'us-east-1' }),
		).toBe('https://shop-production-uploads.s3.us-east-1.amazonaws.com');
	});

	it('is unknown with no region to name, or against an S3 emulator', () => {
		expect(
			plannedSignedOrigin({ ...input, config: { provider: 's3' } }, {}),
		).toBeUndefined();
		expect(
			plannedSignedOrigin(input, { AWS_ENDPOINT_URL: 'http://localhost:4566' }),
		).toBeUndefined();
	});
});
