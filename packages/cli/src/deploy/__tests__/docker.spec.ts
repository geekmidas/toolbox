import { describe, expect, it } from 'vitest';
import { getImageRef, resolveDockerConfig } from '../docker';
import type { GkmConfig } from '../../types';

describe('getImageRef', () => {
	it('should return image with registry prefix', () => {
		const result = getImageRef('ghcr.io/myorg', 'myapp', 'v1.0.0');
		expect(result).toBe('ghcr.io/myorg/myapp:v1.0.0');
	});

	it('should return image without registry when undefined', () => {
		const result = getImageRef(undefined, 'myapp', 'v1.0.0');
		expect(result).toBe('myapp:v1.0.0');
	});

	it('should handle different tag formats', () => {
		expect(getImageRef('docker.io', 'app', 'latest')).toBe(
			'docker.io/app:latest',
		);
		expect(getImageRef('docker.io', 'app', 'sha-abc123')).toBe(
			'docker.io/app:sha-abc123',
		);
		expect(getImageRef('docker.io', 'app', '1.2.3-beta.1')).toBe(
			'docker.io/app:1.2.3-beta.1',
		);
	});

	it('should handle registry with port', () => {
		const result = getImageRef('localhost:5000', 'myapp', 'dev');
		expect(result).toBe('localhost:5000/myapp:dev');
	});

	it('should handle nested registry paths', () => {
		const result = getImageRef('gcr.io/my-project/images', 'api', 'prod');
		expect(result).toBe('gcr.io/my-project/images/api:prod');
	});
});

describe('resolveDockerConfig', () => {
	it('should return empty config when docker not configured', () => {
		const config: GkmConfig = {
			routes: './src/endpoints',
			envParser: './src/env',
			logger: './src/logger',
		};

		const dockerConfig = resolveDockerConfig(config);

		expect(dockerConfig.registry).toBeUndefined();
		expect(dockerConfig.imageName).toBeUndefined();
	});

	it('should return registry from docker config', () => {
		const config: GkmConfig = {
			routes: './src/endpoints',
			envParser: './src/env',
			logger: './src/logger',
			docker: {
				registry: 'ghcr.io/myorg',
			},
		};

		const dockerConfig = resolveDockerConfig(config);

		expect(dockerConfig.registry).toBe('ghcr.io/myorg');
	});

	it('should return imageName from docker config', () => {
		const config: GkmConfig = {
			routes: './src/endpoints',
			envParser: './src/env',
			logger: './src/logger',
			docker: {
				imageName: 'my-api',
			},
		};

		const dockerConfig = resolveDockerConfig(config);

		expect(dockerConfig.imageName).toBe('my-api');
	});

	it('should return both registry and imageName', () => {
		const config: GkmConfig = {
			routes: './src/endpoints',
			envParser: './src/env',
			logger: './src/logger',
			docker: {
				registry: 'docker.io/company',
				imageName: 'backend-api',
			},
		};

		const dockerConfig = resolveDockerConfig(config);

		expect(dockerConfig.registry).toBe('docker.io/company');
		expect(dockerConfig.imageName).toBe('backend-api');
	});

	it('should handle empty docker object', () => {
		const config: GkmConfig = {
			routes: './src/endpoints',
			docker: {},
		};

		const dockerConfig = resolveDockerConfig(config);

		expect(dockerConfig.registry).toBeUndefined();
		expect(dockerConfig.imageName).toBeUndefined();
	});
});
