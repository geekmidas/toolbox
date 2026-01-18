import { describe, expect, it } from 'vitest';
import {
	extractSubdomain,
	findRootDomain,
	generateRequiredRecords,
	groupHostnamesByDomain,
	isLegacyDnsConfig,
	normalizeDnsConfig,
} from '../dns/index';

describe('DNS orchestration helpers', () => {
	describe('isLegacyDnsConfig', () => {
		it('should return true for legacy config with domain property', () => {
			const config = { provider: 'hostinger', domain: 'example.com' };
			expect(isLegacyDnsConfig(config)).toBe(true);
		});

		it('should return false for new multi-domain config', () => {
			const config = {
				'example.com': { provider: 'hostinger' },
				'example.dev': { provider: 'route53' },
			};
			expect(isLegacyDnsConfig(config)).toBe(false);
		});

		it('should return false for config without domain property', () => {
			const config = { provider: 'hostinger' };
			expect(isLegacyDnsConfig(config)).toBe(false);
		});
	});

	describe('normalizeDnsConfig', () => {
		it('should convert legacy config to multi-domain format', () => {
			const config = { provider: 'hostinger', domain: 'example.com', ttl: 300 };
			const normalized = normalizeDnsConfig(config);

			expect(normalized).toEqual({
				'example.com': { provider: 'hostinger', ttl: 300 },
			});
		});

		it('should pass through multi-domain config unchanged', () => {
			const config = {
				'example.com': { provider: 'hostinger' },
				'example.dev': { provider: 'route53' },
			};
			const normalized = normalizeDnsConfig(config);

			expect(normalized).toBe(config);
		});
	});

	describe('findRootDomain', () => {
		const dnsConfig = {
			'traflabs.io': { provider: 'hostinger' as const },
			'geekmidas.com': { provider: 'route53' as const },
			'sub.geekmidas.com': { provider: 'manual' as const },
		};

		it('should find exact domain match', () => {
			expect(findRootDomain('traflabs.io', dnsConfig)).toBe('traflabs.io');
		});

		it('should find root domain for subdomain', () => {
			expect(findRootDomain('api.traflabs.io', dnsConfig)).toBe('traflabs.io');
		});

		it('should find root domain for nested subdomain', () => {
			expect(findRootDomain('staging.api.traflabs.io', dnsConfig)).toBe(
				'traflabs.io',
			);
		});

		it('should prefer more specific domain', () => {
			expect(findRootDomain('api.sub.geekmidas.com', dnsConfig)).toBe(
				'sub.geekmidas.com',
			);
		});

		it('should return null for unknown domain', () => {
			expect(findRootDomain('unknown.com', dnsConfig)).toBeNull();
		});

		it('should return null for domain that is prefix but not subdomain', () => {
			// 'exampletraflabs.io' should not match 'traflabs.io'
			expect(findRootDomain('exampletraflabs.io', dnsConfig)).toBeNull();
		});
	});

	describe('groupHostnamesByDomain', () => {
		const dnsConfig = {
			'traflabs.io': { provider: 'hostinger' as const },
			'geekmidas.com': { provider: 'route53' as const },
		};

		it('should group hostnames by their root domain', () => {
			const appHostnames = new Map([
				['api', 'api.traflabs.io'],
				['web', 'web.traflabs.io'],
				['docs', 'docs.geekmidas.com'],
			]);

			const grouped = groupHostnamesByDomain(appHostnames, dnsConfig);

			expect(grouped.size).toBe(2);
			expect(grouped.get('traflabs.io')?.size).toBe(2);
			expect(grouped.get('traflabs.io')?.get('api')).toBe('api.traflabs.io');
			expect(grouped.get('traflabs.io')?.get('web')).toBe('web.traflabs.io');
			expect(grouped.get('geekmidas.com')?.size).toBe(1);
			expect(grouped.get('geekmidas.com')?.get('docs')).toBe(
				'docs.geekmidas.com',
			);
		});

		it('should skip hostnames without matching domain', () => {
			const appHostnames = new Map([
				['api', 'api.traflabs.io'],
				['unknown', 'api.unknown.com'],
			]);

			const grouped = groupHostnamesByDomain(appHostnames, dnsConfig);

			expect(grouped.size).toBe(1);
			expect(grouped.get('traflabs.io')?.size).toBe(1);
		});
	});

	describe('extractSubdomain', () => {
		it('should extract single-level subdomain', () => {
			expect(extractSubdomain('api.example.com', 'example.com')).toBe('api');
		});

		it('should extract multi-level subdomain', () => {
			expect(extractSubdomain('staging.api.example.com', 'example.com')).toBe(
				'staging.api',
			);
		});

		it('should return @ for root domain', () => {
			expect(extractSubdomain('example.com', 'example.com')).toBe('@');
		});

		it('should throw for hostname not under root domain', () => {
			expect(() => extractSubdomain('api.other.com', 'example.com')).toThrow(
				'not under root domain',
			);
		});
	});

	describe('generateRequiredRecords', () => {
		it('should generate A records for all app hostnames', () => {
			const appHostnames = new Map([
				['api', 'api.example.com'],
				['web', 'web.example.com'],
			]);

			const records = generateRequiredRecords(
				appHostnames,
				'example.com',
				'1.2.3.4',
			);

			expect(records).toHaveLength(2);
			expect(records[0]).toMatchObject({
				hostname: 'api.example.com',
				subdomain: 'api',
				type: 'A',
				value: '1.2.3.4',
				appName: 'api',
			});
			expect(records[1]).toMatchObject({
				hostname: 'web.example.com',
				subdomain: 'web',
				type: 'A',
				value: '1.2.3.4',
				appName: 'web',
			});
		});

		it('should handle nested subdomains', () => {
			const appHostnames = new Map([['api', 'staging.api.example.com']]);

			const records = generateRequiredRecords(
				appHostnames,
				'example.com',
				'1.2.3.4',
			);

			expect(records[0]?.subdomain).toBe('staging.api');
		});
	});
});
