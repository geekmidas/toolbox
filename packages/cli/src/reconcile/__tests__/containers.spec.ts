import { describe, expect, it } from 'vitest';
import { portsOf, primaryPortKey } from '../containers';

/**
 * A container's primary port is the one an app connects to, and it is
 * allocated under that port's own key — so a console port added later does not
 * move it.
 */
describe('primaryPortKey', () => {
	it('allocates a known container under its first port', () => {
		expect(primaryPortKey('minio')).toBe('minio');
		expect(primaryPortKey('mailpit')).toBe('mailpit');
	});

	it('falls back to the container name for one gkm does not know', () => {
		expect(portsOf('custom-sidecar')).toEqual([]);
		expect(primaryPortKey('custom-sidecar')).toBe('custom-sidecar');
	});
});
