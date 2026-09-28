import { describe, expect, it } from 'vitest';
import { compareVersions, prereleaseTag, simpleRange } from '../version';

const order = (a: string, b: string) => Math.sign(compareVersions(a, b));

describe('compareVersions', () => {
	it('orders by major, minor and patch', () => {
		expect(order('10.0.0', '9.9.9')).toBe(1);
		expect(order('1.2.0', '1.10.0')).toBe(-1);
		expect(order('1.2.3', '1.2.3')).toBe(0);
	});

	it('puts a release above any prerelease of it', () => {
		expect(order('10.0.0', '10.0.0-alpha.9')).toBe(1);
		expect(order('10.0.0-alpha.9', '10.0.0')).toBe(-1);
	});

	it('compares prerelease numbers as numbers, not text', () => {
		expect(order('10.0.0-alpha.10', '10.0.0-alpha.9')).toBe(1);
		expect(order('10.0.0-alpha.8', '10.0.0-alpha.8')).toBe(0);
	});

	it('compares prerelease tags as text, and a number below a tag', () => {
		expect(order('10.0.0-beta.1', '10.0.0-alpha.9')).toBe(1);
		expect(order('10.0.0-1', '10.0.0-alpha')).toBe(-1);
		expect(order('10.0.0-alpha', '10.0.0-1')).toBe(1);
	});

	it('puts a shorter prerelease below a longer one it prefixes', () => {
		expect(order('10.0.0-alpha', '10.0.0-alpha.1')).toBe(-1);
		expect(order('10.0.0-alpha.1', '10.0.0-alpha')).toBe(1);
	});

	it('treats what is not a version as equal to anything', () => {
		expect(compareVersions('latest', '1.0.0')).toBe(0);
		expect(compareVersions('1.0.0', 'workspace:*')).toBe(0);
	});
});

describe('prereleaseTag', () => {
	it('is the tag of a prerelease, and nothing for a release', () => {
		expect(prereleaseTag('10.0.0-alpha.6')).toBe('alpha');
		expect(prereleaseTag('9.0.2')).toBeUndefined();
		expect(prereleaseTag('10.0.0-1')).toBeUndefined();
		expect(prereleaseTag('nope')).toBeUndefined();
	});
});

describe('simpleRange', () => {
	it('splits one operator and one version', () => {
		expect(simpleRange('~10.0.0-alpha.6')).toEqual({
			operator: '~',
			version: '10.0.0-alpha.6',
		});
		expect(simpleRange('>=4.13.8')).toEqual({
			operator: '>=',
			version: '4.13.8',
		});
		expect(simpleRange(' 1.2.3 ')).toEqual({ operator: '', version: '1.2.3' });
	});

	it('leaves anything else to a person', () => {
		expect(simpleRange('>=8.0.0 <10')).toBeUndefined();
		expect(simpleRange('^1 || ^2')).toBeUndefined();
		expect(simpleRange('workspace:*')).toBeUndefined();
	});
});
