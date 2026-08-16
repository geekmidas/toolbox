import { describe, expect, it } from 'vitest';
import { build, parse, type S3Address } from '../s3Url';

describe('s3Url', () => {
	const cases: [string, S3Address][] = [
		['deployed', { bucket: 'prod-myapp-uploads', region: 'eu-west-1' }],
		[
			'minio',
			{
				bucket: 'uploads',
				endpoint: 'http://localhost:9000',
				forcePathStyle: true,
			},
		],
		['bucket only', { bucket: 'uploads' }],
	];

	it.each(cases)('round-trips %s', (_name, address) => {
		expect(parse(build(address))).toEqual(address);
	});

	it('addresses the bucket as the host', () => {
		expect(build({ bucket: 'uploads' })).toBe('s3://uploads');
	});

	it('carries the region, because a bucket may not be in the function’s', () => {
		expect(build({ bucket: 'uploads', region: 'eu-west-1' })).toContain(
			'region=eu-west-1',
		);
	});

	it('never carries credentials', () => {
		const url = build({ bucket: 'uploads', endpoint: 'http://localhost:9000' });
		expect(url).not.toMatch(/@|accessKey|secret/i);
	});

	it.each([
		['https://uploads', /Expected an s3/],
		['not a url', /Not a valid URL/],
		['s3://', /No bucket/],
	])('rejects %s', (url, message) => {
		expect(() => parse(url)).toThrow(message);
	});

	it('rejects a build with no bucket', () => {
		expect(() => build({ bucket: '' })).toThrow(/needs a bucket/);
	});

	it('omits absent parts rather than emitting empty values', () => {
		expect(parse('s3://uploads')).toEqual({ bucket: 'uploads' });
	});
});
