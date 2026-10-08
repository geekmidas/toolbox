import { describe, expect, it } from 'vitest';
import {
	bucketPolicy,
	canonicalPolicy,
	corsRule,
	openResource,
	publicAccessBlock,
	userPolicy,
} from '../s3/policy';

describe("the user's inline policy", () => {
	it('grants objects in the bucket and listing it, and nothing else', () => {
		expect(userPolicy('acme-shop-prod-uploads')).toEqual({
			Version: '2012-10-17',
			Statement: [
				{
					Sid: 'GkmObjects',
					Effect: 'Allow',
					Action: [
						's3:GetObject',
						's3:PutObject',
						's3:DeleteObject',
						's3:AbortMultipartUpload',
						's3:ListMultipartUploadParts',
					],
					Resource: 'arn:aws:s3:::acme-shop-prod-uploads/*',
				},
				{
					Sid: 'GkmBucket',
					Effect: 'Allow',
					Action: [
						's3:ListBucket',
						's3:GetBucketLocation',
						's3:ListBucketMultipartUploads',
					],
					Resource: 'arn:aws:s3:::acme-shop-prod-uploads',
				},
			],
		});
	});

	it('adds reading old versions when the bucket keeps them', () => {
		const [objects] = userPolicy('b', { versioning: true }).Statement;
		expect(objects?.Action).toContain('s3:GetObjectVersion');
	});
});

describe("the bucket's policy", () => {
	it('refuses anything not over TLS', () => {
		expect(bucketPolicy('b')).toEqual({
			Version: '2012-10-17',
			Statement: [
				{
					Sid: 'GkmDenyInsecureTransport',
					Effect: 'Deny',
					Principal: '*',
					Action: 's3:*',
					Resource: ['arn:aws:s3:::b', 'arn:aws:s3:::b/*'],
					Condition: { Bool: { 'aws:SecureTransport': 'false' } },
				},
			],
		});
	});

	it("opens exactly a file server's open prefixes to anonymous reads", () => {
		const policy = bucketPolicy('b', ['brand/**', 'avatars/*.png']);
		expect(policy.Statement[1]).toEqual({
			Sid: 'GkmOpenPaths',
			Effect: 'Allow',
			Principal: '*',
			Action: 's3:GetObject',
			Resource: ['arn:aws:s3:::b/avatars/*.png', 'arn:aws:s3:::b/brand/*'],
		});
		expect(openResource('b', '/brand/**')).toBe('arn:aws:s3:::b/brand/*');
	});
});

describe('Block Public Access', () => {
	it('blocks all four with no open paths', () => {
		expect(publicAccessBlock(false)).toEqual({
			BlockPublicAcls: true,
			IgnorePublicAcls: true,
			BlockPublicPolicy: true,
			RestrictPublicBuckets: true,
		});
	});

	it('relaxes only what a public policy needs, and keeps ACLs blocked', () => {
		expect(publicAccessBlock(true)).toEqual({
			BlockPublicAcls: true,
			IgnorePublicAcls: true,
			BlockPublicPolicy: false,
			RestrictPublicBuckets: false,
		});
	});
});

describe('CORS', () => {
	it('lets the sites upload and read, and exposes the ETag', () => {
		expect(
			corsRule(['https://shop.example.com', 'https://admin.shop.example.com']),
		).toEqual({
			AllowedMethods: ['GET', 'HEAD', 'POST', 'PUT'],
			AllowedOrigins: [
				'https://admin.shop.example.com',
				'https://shop.example.com',
			],
			AllowedHeaders: ['*'],
			ExposeHeaders: ['ETag'],
			MaxAgeSeconds: 3000,
		});
	});
});

describe('comparing policies', () => {
	it('reads a document AWS reformatted as the same one', () => {
		const ours = userPolicy('b');
		const theirs = {
			Statement: ours.Statement.map((s) => ({
				Resource: [s.Resource],
				Action: [...(s.Action as string[])].reverse(),
				Effect: s.Effect,
				Sid: s.Sid,
			})),
			Version: '2012-10-17',
		};
		expect(canonicalPolicy(theirs)).toBe(canonicalPolicy(ours));
	});

	it('tells a changed document apart', () => {
		expect(canonicalPolicy(userPolicy('a'))).not.toBe(
			canonicalPolicy(userPolicy('b')),
		);
	});
});
