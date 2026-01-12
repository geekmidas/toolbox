import { describe, expect, it } from 'vitest';
import {
	generateCacheKeys,
	generateIpAddresses,
	generateTestData,
	randomIpAddress,
} from '../benchmark';

describe('generateTestData', () => {
	it('should generate the specified number of records', () => {
		const data = generateTestData(5);
		expect(data).toHaveLength(5);
	});

	it('should generate records with expected structure', () => {
		const data = generateTestData(3);

		for (const record of data) {
			expect(record).toHaveProperty('id');
			expect(record).toHaveProperty('name');
			expect(record).toHaveProperty('value');
			expect(typeof record.id).toBe('string');
			expect(typeof record.name).toBe('string');
			expect(typeof record.value).toBe('number');
		}
	});

	it('should generate sequential IDs', () => {
		const data = generateTestData(3);
		expect(data[0].id).toBe('id-0');
		expect(data[1].id).toBe('id-1');
		expect(data[2].id).toBe('id-2');
	});

	it('should generate sequential names', () => {
		const data = generateTestData(3);
		expect(data[0].name).toBe('Item 0');
		expect(data[1].name).toBe('Item 1');
		expect(data[2].name).toBe('Item 2');
	});

	it('should generate random values between 0 and 1000', () => {
		const data = generateTestData(100);

		for (const record of data) {
			expect(record.value).toBeGreaterThanOrEqual(0);
			expect(record.value).toBeLessThan(1000);
		}
	});

	it('should return empty array for count 0', () => {
		const data = generateTestData(0);
		expect(data).toEqual([]);
	});
});

describe('generateCacheKeys', () => {
	it('should generate the specified number of keys', () => {
		const keys = generateCacheKeys('test', 5);
		expect(keys).toHaveLength(5);
	});

	it('should use the provided prefix', () => {
		const keys = generateCacheKeys('user', 3);
		expect(keys[0]).toBe('user:0');
		expect(keys[1]).toBe('user:1');
		expect(keys[2]).toBe('user:2');
	});

	it('should return empty array for count 0', () => {
		const keys = generateCacheKeys('test', 0);
		expect(keys).toEqual([]);
	});

	it('should handle empty prefix', () => {
		const keys = generateCacheKeys('', 2);
		expect(keys[0]).toBe(':0');
		expect(keys[1]).toBe(':1');
	});
});

describe('generateIpAddresses', () => {
	it('should generate the specified number of IPs', () => {
		const ips = generateIpAddresses(5);
		expect(ips).toHaveLength(5);
	});

	it('should use default subnet 192.168.1', () => {
		const ips = generateIpAddresses(3);
		expect(ips[0]).toBe('192.168.1.0');
		expect(ips[1]).toBe('192.168.1.1');
		expect(ips[2]).toBe('192.168.1.2');
	});

	it('should use custom subnet', () => {
		const ips = generateIpAddresses(2, '10.0.0');
		expect(ips[0]).toBe('10.0.0.0');
		expect(ips[1]).toBe('10.0.0.1');
	});

	it('should wrap last octet at 256', () => {
		const ips = generateIpAddresses(260);
		expect(ips[0]).toBe('192.168.1.0');
		expect(ips[255]).toBe('192.168.1.255');
		expect(ips[256]).toBe('192.168.1.0'); // Wraps around
		expect(ips[257]).toBe('192.168.1.1');
	});

	it('should return empty array for count 0', () => {
		const ips = generateIpAddresses(0);
		expect(ips).toEqual([]);
	});
});

describe('randomIpAddress', () => {
	it('should generate valid IP address format', () => {
		const ip = randomIpAddress();
		const parts = ip.split('.');

		expect(parts).toHaveLength(4);

		for (const part of parts) {
			const num = Number.parseInt(part, 10);
			expect(num).toBeGreaterThanOrEqual(0);
			expect(num).toBeLessThanOrEqual(255);
		}
	});

	it('should generate different IPs on multiple calls', () => {
		const ips = new Set<string>();

		// Generate 10 IPs and check we get at least some variation
		for (let i = 0; i < 10; i++) {
			ips.add(randomIpAddress());
		}

		// With random generation, we should get at least 2 unique IPs
		expect(ips.size).toBeGreaterThan(1);
	});
});
