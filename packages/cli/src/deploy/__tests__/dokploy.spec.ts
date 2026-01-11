import { describe, expect, it } from 'vitest';
import { validateDokployConfig } from '../dokploy';
import type { DokployDeployConfig } from '../types';

describe('validateDokployConfig', () => {
	it('should return true for valid complete config', () => {
		const config: DokployDeployConfig = {
			endpoint: 'https://dokploy.example.com',
			projectId: 'proj_123',
			applicationId: 'app_456',
		};

		const result = validateDokployConfig(config);
		expect(result).toBe(true);
	});

	it('should return true with optional registry', () => {
		const config: DokployDeployConfig = {
			endpoint: 'https://dokploy.example.com',
			projectId: 'proj_123',
			applicationId: 'app_456',
			registry: 'ghcr.io/myorg',
		};

		const result = validateDokployConfig(config);
		expect(result).toBe(true);
	});

	it('should return false for undefined config', () => {
		const result = validateDokployConfig(undefined);
		expect(result).toBe(false);
	});

	it('should throw for missing endpoint', () => {
		const config = {
			projectId: 'proj_123',
			applicationId: 'app_456',
		} as Partial<DokployDeployConfig>;

		expect(() => validateDokployConfig(config)).toThrow(
			'Missing Dokploy configuration: endpoint',
		);
	});

	it('should throw for missing projectId', () => {
		const config = {
			endpoint: 'https://dokploy.example.com',
			applicationId: 'app_456',
		} as Partial<DokployDeployConfig>;

		expect(() => validateDokployConfig(config)).toThrow(
			'Missing Dokploy configuration: projectId',
		);
	});

	it('should throw for missing applicationId', () => {
		const config = {
			endpoint: 'https://dokploy.example.com',
			projectId: 'proj_123',
		} as Partial<DokployDeployConfig>;

		expect(() => validateDokployConfig(config)).toThrow(
			'Missing Dokploy configuration: applicationId',
		);
	});

	it('should list all missing fields', () => {
		const config = {
			endpoint: 'https://dokploy.example.com',
		} as Partial<DokployDeployConfig>;

		expect(() => validateDokployConfig(config)).toThrow(
			'Missing Dokploy configuration: projectId, applicationId',
		);
	});

	it('should throw for empty config object', () => {
		const config = {} as Partial<DokployDeployConfig>;

		expect(() => validateDokployConfig(config)).toThrow(
			'Missing Dokploy configuration: endpoint, projectId, applicationId',
		);
	});

	it('should include configuration example in error', () => {
		const config = {} as Partial<DokployDeployConfig>;

		expect(() => validateDokployConfig(config)).toThrow(
			'Configure in gkm.config.ts:',
		);
	});
});
