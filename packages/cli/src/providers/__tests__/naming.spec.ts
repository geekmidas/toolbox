import { describe, expect, it } from 'vitest';
import {
	BUCKET_NAME_MAX,
	bucketName,
	bucketNameProblem,
	IAM_USER_NAME_MAX,
	InvalidBucketName,
	iamUserName,
	randomSuffix,
	SUFFIX_LENGTH,
	suffixedBucketName,
} from '../s3/naming';

describe('bucket names', () => {
	it('is <namespace>-<project>-<stage>-<id>, lowercased and kebab-cased', () => {
		expect(
			bucketName({ scope: 'acme-shop', stage: 'prod', id: 'UserUploads' }),
		).toBe('acme-shop-prod-user-uploads');
	});

	it('drops what S3 refuses: dots, underscores, capitals, edge dashes', () => {
		expect(
			bucketName({ scope: 'shop', stage: 'Pre.Prod_2', id: '-files-' }),
		).toBe('shop-pre-prod-2-files');
	});

	it('shortens the longest part first, leaving room for a suffix', () => {
		const name = bucketName({
			scope: 'a-very-long-organisation-name-shop',
			stage: 'production',
			id: 'customer-generated-content-uploads-archive',
		});

		expect(name.length).toBeLessThanOrEqual(BUCKET_NAME_MAX - SUFFIX_LENGTH);
		expect(name.startsWith('a-very-long')).toBe(true);
		expect(name).toContain('-production-');
		expect(name).toMatch(/-customer/);
		expect(bucketNameProblem(name)).toBeUndefined();
		// The suffixed name still fits.
		const suffixed = suffixedBucketName(name, randomSuffix());
		expect(suffixed.length).toBeLessThanOrEqual(BUCKET_NAME_MAX);
		expect(bucketNameProblem(suffixed)).toBeUndefined();
	});

	it('is the same name every time it is asked', () => {
		const input = { scope: 'shop', stage: 'prod', id: 'Uploads' };
		expect(bucketName(input)).toBe(bucketName(input));
	});

	it('refuses a name S3 reserves', () => {
		expect(() =>
			bucketName({ scope: 'sthree', stage: 'prod', id: 'uploads' }),
		).toThrow(InvalidBucketName);
	});

	it('knows S3’s rules', () => {
		expect(bucketNameProblem('ab')).toMatch(/3 to 63/);
		expect(bucketNameProblem('a'.repeat(64))).toMatch(/3 to 63/);
		expect(bucketNameProblem('has.dots')).toMatch(/lowercase/);
		expect(bucketNameProblem('Upper')).toMatch(/lowercase/);
		expect(bucketNameProblem('-edge')).toMatch(/start and end/);
		expect(bucketNameProblem('files-s3alias')).toMatch(/reserves/);
		expect(bucketNameProblem('acme-shop-prod-uploads')).toBeUndefined();
	});
});

describe('the clash suffix', () => {
	it('is six characters of [a-z0-9]', () => {
		for (let i = 0; i < 50; i++) {
			expect(randomSuffix()).toMatch(/^[a-z0-9]{6}$/);
		}
	});

	it('is appended after a dash', () => {
		expect(suffixedBucketName('shop-prod-uploads', 'x7k2q9')).toBe(
			'shop-prod-uploads-x7k2q9',
		);
	});
});

describe('IAM user names', () => {
	it('is gkm-<project>-<stage>-<id>', () => {
		expect(
			iamUserName({ scope: 'acme-shop', stage: 'prod', id: 'Uploads' }),
		).toBe('gkm-acme-shop-prod-uploads');
	});

	it('fits 64 characters', () => {
		const name = iamUserName({
			scope: 'a-very-long-organisation-name-shop',
			stage: 'production',
			id: 'customer-generated-content-uploads-archive',
		});
		expect(name.length).toBeLessThanOrEqual(IAM_USER_NAME_MAX);
		expect(name.startsWith('gkm-')).toBe(true);
	});
});
