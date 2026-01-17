import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createEmptyState, type DokployStageState } from '../state';

// Mock dns/promises lookup
vi.mock('node:dns/promises', () => ({
	lookup: vi.fn(),
}));

// Import after mocking
import { lookup } from 'node:dns/promises';
import { verifyDnsRecords, resolveHostnameToIp } from '../dns/index';

describe('resolveHostnameToIp', () => {
	const mockLookup = vi.mocked(lookup);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should resolve hostname to IPv4 address', async () => {
		mockLookup.mockResolvedValue({ address: '1.2.3.4', family: 4 });

		const ip = await resolveHostnameToIp('example.com');

		expect(ip).toBe('1.2.3.4');
		expect(mockLookup).toHaveBeenCalledWith('example.com', { family: 4 });
	});

	it('should throw error when resolution fails', async () => {
		mockLookup.mockRejectedValue(new Error('NXDOMAIN'));

		await expect(resolveHostnameToIp('invalid.example.com')).rejects.toThrow(
			'Failed to resolve IP for invalid.example.com: NXDOMAIN',
		);
	});
});

describe('verifyDnsRecords', () => {
	const mockLookup = vi.mocked(lookup);
	let state: DokployStageState;

	// Suppress console.log during tests
	const originalLog = console.log;

	beforeEach(() => {
		vi.clearAllMocks();
		state = createEmptyState('production', 'env-123');
		console.log = vi.fn();
	});

	afterEach(() => {
		console.log = originalLog;
	});

	it('should verify DNS records that resolve correctly', async () => {
		mockLookup.mockResolvedValue({ address: '1.2.3.4', family: 4 });

		const appHostnames = new Map([
			['api', 'api.example.com'],
			['auth', 'auth.example.com'],
		]);

		const results = await verifyDnsRecords(appHostnames, '1.2.3.4', state);

		expect(results).toHaveLength(2);
		expect(results[0]).toMatchObject({
			hostname: 'api.example.com',
			appName: 'api',
			verified: true,
			resolvedIp: '1.2.3.4',
			expectedIp: '1.2.3.4',
		});
		expect(results[1]).toMatchObject({
			hostname: 'auth.example.com',
			appName: 'auth',
			verified: true,
			resolvedIp: '1.2.3.4',
			expectedIp: '1.2.3.4',
		});

		// Should have stored verification in state
		expect(state.dnsVerified).toBeDefined();
		expect(state.dnsVerified!['api.example.com']?.serverIp).toBe('1.2.3.4');
		expect(state.dnsVerified!['auth.example.com']?.serverIp).toBe('1.2.3.4');
	});

	it('should skip verification for already-verified hostnames', async () => {
		// Pre-populate state with verified hostname
		state.dnsVerified = {
			'api.example.com': {
				serverIp: '1.2.3.4',
				verifiedAt: '2024-01-01T00:00:00.000Z',
			},
		};

		const appHostnames = new Map([['api', 'api.example.com']]);

		const results = await verifyDnsRecords(appHostnames, '1.2.3.4', state);

		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			hostname: 'api.example.com',
			appName: 'api',
			verified: true,
			skipped: true,
			expectedIp: '1.2.3.4',
		});

		// Should NOT have called lookup for cached result
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it('should re-verify when server IP changes', async () => {
		// Pre-populate state with different server IP
		state.dnsVerified = {
			'api.example.com': {
				serverIp: '9.9.9.9',
				verifiedAt: '2024-01-01T00:00:00.000Z',
			},
		};

		mockLookup.mockResolvedValue({ address: '1.2.3.4', family: 4 });

		const appHostnames = new Map([['api', 'api.example.com']]);

		const results = await verifyDnsRecords(appHostnames, '1.2.3.4', state);

		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			hostname: 'api.example.com',
			appName: 'api',
			verified: true,
			resolvedIp: '1.2.3.4',
		});
		// Should NOT be skipped (it was re-verified)
		expect(results[0]?.skipped).toBeUndefined();

		// Should have called lookup since IP changed
		expect(mockLookup).toHaveBeenCalledTimes(1);

		// Should have updated verification
		expect(state.dnsVerified!['api.example.com']?.serverIp).toBe('1.2.3.4');
	});

	it('should handle DNS resolution failure gracefully', async () => {
		mockLookup.mockRejectedValue(new Error('NXDOMAIN'));

		const appHostnames = new Map([['api', 'api.example.com']]);

		const results = await verifyDnsRecords(appHostnames, '1.2.3.4', state);

		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			hostname: 'api.example.com',
			appName: 'api',
			verified: false,
			expectedIp: '1.2.3.4',
			error: expect.stringContaining('NXDOMAIN'),
		});

		// Should NOT have stored verification for failed lookup
		expect(state.dnsVerified).toBeUndefined();
	});

	it('should detect when DNS resolves to wrong IP', async () => {
		mockLookup.mockResolvedValue({ address: '9.9.9.9', family: 4 });

		const appHostnames = new Map([['api', 'api.example.com']]);

		const results = await verifyDnsRecords(appHostnames, '1.2.3.4', state);

		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			hostname: 'api.example.com',
			appName: 'api',
			verified: false,
			resolvedIp: '9.9.9.9',
			expectedIp: '1.2.3.4',
		});

		// Should NOT have stored verification for wrong IP
		expect(state.dnsVerified).toBeUndefined();
	});

	it('should handle mix of verified, cached, and pending hostnames', async () => {
		// Pre-populate state with one verified hostname
		state.dnsVerified = {
			'cached.example.com': {
				serverIp: '1.2.3.4',
				verifiedAt: '2024-01-01T00:00:00.000Z',
			},
		};

		mockLookup
			.mockResolvedValueOnce({ address: '1.2.3.4', family: 4 })
			.mockRejectedValueOnce(new Error('NXDOMAIN'));

		const appHostnames = new Map([
			['cached', 'cached.example.com'],
			['new-verified', 'new.example.com'],
			['pending', 'pending.example.com'],
		]);

		const results = await verifyDnsRecords(appHostnames, '1.2.3.4', state);

		expect(results).toHaveLength(3);

		// Cached should be skipped
		expect(results[0]).toMatchObject({
			hostname: 'cached.example.com',
			verified: true,
			skipped: true,
		});

		// New should be verified
		expect(results[1]).toMatchObject({
			hostname: 'new.example.com',
			verified: true,
			resolvedIp: '1.2.3.4',
		});

		// Pending should fail
		expect(results[2]).toMatchObject({
			hostname: 'pending.example.com',
			verified: false,
			error: expect.stringContaining('NXDOMAIN'),
		});
	});
});
