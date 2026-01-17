import { describe, expect, it } from 'vitest';
import {
	createDnsProvider,
	isDnsProvider,
	type DnsProvider,
	type DnsRecord,
	type UpsertDnsRecord,
	type UpsertResult,
} from '../dns/DnsProvider';

describe('isDnsProvider', () => {
	it('should return true for valid provider', () => {
		const provider: DnsProvider = {
			name: 'test',
			getRecords: async () => [],
			upsertRecords: async () => [],
		};
		expect(isDnsProvider(provider)).toBe(true);
	});

	it('should return false for null', () => {
		expect(isDnsProvider(null)).toBe(false);
	});

	it('should return false for undefined', () => {
		expect(isDnsProvider(undefined)).toBe(false);
	});

	it('should return false for empty object', () => {
		expect(isDnsProvider({})).toBe(false);
	});

	it('should return false for object with only name', () => {
		expect(isDnsProvider({ name: 'test' })).toBe(false);
	});

	it('should return false for object with only getRecords', () => {
		expect(isDnsProvider({ getRecords: () => [] })).toBe(false);
	});

	it('should return false for object with only upsertRecords', () => {
		expect(isDnsProvider({ upsertRecords: () => [] })).toBe(false);
	});

	it('should return false for object with name and getRecords only', () => {
		expect(isDnsProvider({ name: 'test', getRecords: () => [] })).toBe(false);
	});

	it('should return false for object with non-string name', () => {
		expect(
			isDnsProvider({
				name: 123,
				getRecords: () => [],
				upsertRecords: () => [],
			}),
		).toBe(false);
	});
});

describe('createDnsProvider', () => {
	describe('manual provider', () => {
		it('should return null for manual provider', async () => {
			const provider = await createDnsProvider({
				config: { provider: 'manual', domain: 'example.com' },
			});

			expect(provider).toBeNull();
		});
	});

	describe('hostinger provider', () => {
		it('should create HostingerProvider for hostinger config', async () => {
			const provider = await createDnsProvider({
				config: { provider: 'hostinger', domain: 'example.com' },
			});

			expect(provider).not.toBeNull();
			expect(provider?.name).toBe('hostinger');
		});
	});

	describe('route53 provider', () => {
		it('should create Route53Provider for route53 config', async () => {
			const provider = await createDnsProvider({
				config: {
					provider: 'route53',
					domain: 'example.com',
					region: 'us-east-1',
				},
			});

			expect(provider).not.toBeNull();
			expect(provider?.name).toBe('route53');
		});

		it('should create Route53Provider with hostedZoneId', async () => {
			const provider = await createDnsProvider({
				config: {
					provider: 'route53',
					domain: 'example.com',
					region: 'us-west-2',
					hostedZoneId: 'Z1234567890',
				},
			});

			expect(provider).not.toBeNull();
			expect(provider?.name).toBe('route53');
		});
	});

	describe('cloudflare provider', () => {
		it('should throw for cloudflare provider (not yet implemented)', async () => {
			await expect(
				createDnsProvider({
					config: { provider: 'cloudflare', domain: 'example.com' },
				}),
			).rejects.toThrow('Cloudflare DNS provider not yet implemented');
		});
	});

	describe('custom provider', () => {
		it('should use custom provider implementation', async () => {
			const customProvider: DnsProvider = {
				name: 'custom-test',
				async getRecords(): Promise<DnsRecord[]> {
					return [];
				},
				async upsertRecords(): Promise<UpsertResult[]> {
					return [];
				},
			};

			const provider = await createDnsProvider({
				config: {
					provider: customProvider,
					domain: 'example.com',
				},
			});

			expect(provider).toBe(customProvider);
		});

		it('should use custom provider with getRecords that returns data', async () => {
			const mockRecords: DnsRecord[] = [
				{ name: 'api', type: 'A', ttl: 300, values: ['1.2.3.4'] },
			];

			const customProvider: DnsProvider = {
				name: 'custom-test',
				async getRecords(): Promise<DnsRecord[]> {
					return mockRecords;
				},
				async upsertRecords(
					_domain: string,
					records: UpsertDnsRecord[],
				): Promise<UpsertResult[]> {
					return records.map((r) => ({
						record: r,
						created: true,
						unchanged: false,
					}));
				},
			};

			const provider = await createDnsProvider({
				config: {
					provider: customProvider,
					domain: 'example.com',
				},
			});

			const records = await provider!.getRecords('example.com');
			expect(records).toEqual(mockRecords);
		});
	});
});
