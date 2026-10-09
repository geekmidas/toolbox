import { describe, expect, it } from 'vitest';
import {
	IncompleteStorageCredentials,
	MalformedStorageUrl,
	MissingStorageBucket,
	UnexpectedStorageScheme,
} from '../errors';
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
		[
			'credentials whose secret has / and +',
			{
				bucket: 'uploads',
				region: 'eu-west-1',
				accessKeyId: 'AKIAEXAMPLE',
				secretAccessKey: 'wJal/rXUtnFEMI+K7MDENG/bPxRfi+CYEXAMPLE=',
			},
		],
		[
			'credentials whose secret has /, +, = and %, and looks encoded',
			{
				bucket: 'uploads',
				region: 'eu-west-1',
				accessKeyId: 'AKIAEXAMPLE',
				secretAccessKey: 'a/b+c=d%2Fe%2B+/==',
			},
		],
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

	it('carries no credentials unless the address has them', () => {
		const url = build({ bucket: 'uploads', endpoint: 'http://localhost:9000' });
		expect(url).not.toMatch(/@|accessKey|secret/i);
	});

	it('writes credentials as percent-encoded userinfo', () => {
		const url = build({
			bucket: 'uploads',
			accessKeyId: 'AKIAEXAMPLE',
			secretAccessKey: 'a/b+c',
		});
		expect(url).toBe('s3://AKIAEXAMPLE:a%2Fb%2Bc@uploads');
	});

	it('reads credentials from the userinfo, percent-decoded', () => {
		expect(
			parse('s3://AKIAEXAMPLE:a%2Fb%2Bc%40d@uploads?region=eu-west-1'),
		).toEqual({
			bucket: 'uploads',
			region: 'eu-west-1',
			accessKeyId: 'AKIAEXAMPLE',
			secretAccessKey: 'a/b+c@d',
		});
	});

	it.each([
		['s3://AKIAEXAMPLE@uploads', 'secretAccessKey'],
		['s3://AKIAEXAMPLE:@uploads', 'secretAccessKey'],
		['s3://:secret@uploads', 'accessKeyId'],
	])('rejects half a key pair in %s', (url, missing) => {
		expect.assertions(3);
		try {
			parse(url);
		} catch (error) {
			const e = error as IncompleteStorageCredentials;
			expect(e).toBeInstanceOf(IncompleteStorageCredentials);
			expect(e.missing).toBe(missing);
			expect(e.url).not.toContain('secret');
		}
	});

	it('rejects a build with half a key pair', () => {
		expect(() =>
			build({ bucket: 'uploads', accessKeyId: 'AKIAEXAMPLE' }),
		).toThrow(IncompleteStorageCredentials);
		expect(() => build({ bucket: 'uploads', secretAccessKey: 'shh' })).toThrow(
			IncompleteStorageCredentials,
		);
	});

	it.each([
		['https://uploads', UnexpectedStorageScheme],
		['not a url', MalformedStorageUrl],
		['s3://', MissingStorageBucket],
	])('rejects %s with a typed error', (url, expected) => {
		expect(() => parse(url)).toThrow(expected);
	});

	it('rejects a build with no bucket', () => {
		expect(() => build({ bucket: '' })).toThrow(MissingStorageBucket);
	});

	it('carries the offending value rather than interpolating it', () => {
		expect.assertions(4);
		try {
			parse('https://uploads');
		} catch (error) {
			const e = error as UnexpectedStorageScheme;
			expect(e.url).toBe('https://uploads');
			expect(e.actual).toBe('https:');
			expect(e.expected).toBe('s3:');
			// the message states the rule, so it is the same every time
			expect(e.message).toBe('Storage URL is for a different provider');
		}
	});

	it('omits absent parts rather than emitting empty values', () => {
		expect(parse('s3://uploads')).toEqual({ bucket: 'uploads' });
	});
});
