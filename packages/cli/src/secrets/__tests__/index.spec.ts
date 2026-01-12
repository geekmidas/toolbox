import { describe, expect, it } from 'vitest';
import { getServicesFromConfig, maskUrl } from '../index';

describe('getServicesFromConfig', () => {
	it('should return empty array when services is undefined', () => {
		const result = getServicesFromConfig(undefined);
		expect(result).toEqual([]);
	});

	it('should return array as-is when services is an array', () => {
		const services = ['postgres', 'redis'] as const;
		const result = getServicesFromConfig([...services]);
		expect(result).toEqual(['postgres', 'redis']);
	});

	it('should extract service names from object config', () => {
		const services = {
			postgres: true,
			redis: { port: 6379 },
			rabbitmq: false,
		};
		const result = getServicesFromConfig(services);
		expect(result).toContain('postgres');
		expect(result).toContain('redis');
		expect(result).not.toContain('rabbitmq');
	});

	it('should handle empty object', () => {
		const result = getServicesFromConfig({});
		expect(result).toEqual([]);
	});

	it('should handle all falsy values in object', () => {
		const services = {
			postgres: false,
			redis: null,
			rabbitmq: undefined,
		};
		const result = getServicesFromConfig(services as Record<string, unknown>);
		expect(result).toEqual([]);
	});
});

describe('maskUrl', () => {
	it('should mask password in URL', () => {
		const url = 'postgres://user:secretpassword@localhost:5432/db';
		const masked = maskUrl(url);
		expect(masked).not.toContain('secretpassword');
		expect(masked).toContain('user');
		expect(masked).toContain('localhost');
		expect(masked).toContain('5432');
		expect(masked).toContain('db');
	});

	it('should handle URL without password', () => {
		const url = 'redis://localhost:6379';
		const masked = maskUrl(url);
		// URL object normalizes the format
		expect(masked).toContain('redis://');
		expect(masked).toContain('localhost:6379');
	});

	it('should handle URL with username only', () => {
		const url = 'postgres://user@localhost:5432/db';
		const masked = maskUrl(url);
		expect(masked).toContain('user');
		expect(masked).toContain('localhost');
	});

	it('should return original string for invalid URL', () => {
		const invalid = 'not-a-url';
		const result = maskUrl(invalid);
		expect(result).toBe('not-a-url');
	});

	it('should handle amqp URLs', () => {
		const url = 'amqp://guest:guestpass@localhost:5672/vhost';
		const masked = maskUrl(url);
		expect(masked).not.toContain('guestpass');
		expect(masked).toContain('guest');
		expect(masked).toContain('vhost');
	});

	it('should handle https URLs with credentials', () => {
		const url = 'https://user:apikey123@api.example.com/v1';
		const masked = maskUrl(url);
		expect(masked).not.toContain('apikey123');
		expect(masked).toContain('user');
		expect(masked).toContain('api.example.com');
	});
});
