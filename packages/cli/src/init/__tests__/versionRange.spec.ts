import { describe, expect, it } from 'vitest';
import { versionRange } from '../versionRange';

describe('versionRange', () => {
	it('takes the patches of a stable version', () => {
		expect(versionRange('9.4.0')).toBe('~9.4.0');
	});

	it('takes later prereleases of a prerelease, and not the release', () => {
		// `~10.0.0-alpha.152` would admit 10.0.0, and a stray 10.0.0 is on npm.
		expect(versionRange('10.0.0-alpha.152')).toBe('>=10.0.0-alpha.152 <10.0.0');
	});
});
