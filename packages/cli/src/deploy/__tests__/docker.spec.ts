import { describe, expect, it } from 'vitest';
import { resolveDockerConfig } from '../docker';
import type { GkmConfig } from '../../types';

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
});
