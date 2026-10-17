import type { LifecycleRule } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { expireRuleId, expireRules, mergeLifecycle } from '../s3/lifecycle';

describe('expireRuleId', () => {
	it('is gkm-owned, readable, and unique however the prefix is spelled', () => {
		expect(expireRuleId('quotes/')).toMatch(/^gkm-expire-quotes-[0-9a-f]{8}$/);
		// `a/b` and `a-b` read alike once sanitised; the hash keeps them apart.
		expect(expireRuleId('a/b')).not.toBe(expireRuleId('a-b'));
		expect(expireRuleId('quotes/')).toBe(expireRuleId('quotes/'));
	});
});

describe('mergeLifecycle', () => {
	const foreign: LifecycleRule = {
		ID: 'abort-multipart',
		Status: 'Enabled',
		Filter: { Prefix: '' },
		AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
	};

	it('adds the declared rules to a bucket with none', () => {
		const merge = mergeLifecycle(undefined, { 'quotes/': 30 });

		expect(merge).toEqual({
			changed: true,
			rules: expireRules({ 'quotes/': 30 }),
			describe: 'expire quotes/ after 30 days',
		});
	});

	it('changes nothing when gkm’s rules already say it, in any order', () => {
		const expire = { 'quotes/': 30, 'tmp/': 1 };
		const current = [foreign, ...expireRules(expire).reverse()];

		expect(mergeLifecycle(current, expire).changed).toBe(false);
	});

	it('reads a legacy top-level prefix as the same rule', () => {
		const [rule] = expireRules({ 'quotes/': 30 });
		const legacy: LifecycleRule = {
			ID: rule!.ID,
			Status: 'Enabled',
			Prefix: 'quotes/',
			Expiration: { Days: 30 },
		};

		expect(mergeLifecycle([legacy], { 'quotes/': 30 }).changed).toBe(false);
	});

	it('rewrites a changed day count, keeping every foreign rule first', () => {
		const merge = mergeLifecycle([foreign, ...expireRules({ 'quotes/': 14 })], {
			'quotes/': 30,
		});

		expect(merge.changed).toBe(true);
		expect(merge.rules).toEqual([foreign, ...expireRules({ 'quotes/': 30 })]);
	});

	it('drops a gkm rule nothing declares any more', () => {
		const merge = mergeLifecycle(
			[foreign, ...expireRules({ 'old/': 3 })],
			undefined,
		);

		expect(merge).toEqual({
			changed: true,
			rules: [foreign],
			describe: 'remove expiry rules',
		});
	});

	it('leaves a bucket with only foreign rules and no expiry alone', () => {
		expect(mergeLifecycle([foreign], undefined).changed).toBe(false);
	});
});
