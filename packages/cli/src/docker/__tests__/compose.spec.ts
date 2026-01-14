import { describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types.js';
import {
	type ComposeOptions,
	DEFAULT_SERVICE_IMAGES,
	DEFAULT_SERVICE_VERSIONS,
	generateDockerCompose,
	generateMinimalDockerCompose,
	generateWorkspaceCompose,
} from '../compose';

/** Helper to get full default image reference */
function getDefaultImage(service: 'postgres' | 'redis' | 'rabbitmq'): string {
	return `${DEFAULT_SERVICE_IMAGES[service]}:${DEFAULT_SERVICE_VERSIONS[service]}`;
}

describe('generateDockerCompose', () => {
	const baseOptions: ComposeOptions = {
		imageName: 'my-api',
		registry: 'ghcr.io/myorg',
		port: 3000,
		healthCheckPath: '/health',
		services: {},
	};

	describe('api service', () => {
		it('should generate valid docker-compose version', () => {
			const yaml = generateDockerCompose(baseOptions);

			expect(yaml).toContain("version: '3.8'");
		});

		it('should include api service with correct image reference', () => {
			const yaml = generateDockerCompose(baseOptions);

			expect(yaml).toContain('services:');
			expect(yaml).toContain('api:');
			expect(yaml).toContain(
				'image: ${REGISTRY:-ghcr.io/myorg}/${IMAGE_NAME:-my-api}:${TAG:-latest}',
			);
		});

		it('should set container name from imageName', () => {
			const yaml = generateDockerCompose(baseOptions);

			expect(yaml).toContain('container_name: my-api');
		});

		it('should configure port mapping', () => {
			const yaml = generateDockerCompose(baseOptions);

			expect(yaml).toContain('- "${PORT:-3000}:3000"');
		});

		it('should set NODE_ENV to production', () => {
			const yaml = generateDockerCompose(baseOptions);

			expect(yaml).toContain('- NODE_ENV=production');
		});

		it('should include health check with configured path', () => {
			const yaml = generateDockerCompose(baseOptions);

			expect(yaml).toContain('healthcheck:');
			expect(yaml).toContain(
				'test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]',
			);
			expect(yaml).toContain('interval: 30s');
			expect(yaml).toContain('timeout: 3s');
			expect(yaml).toContain('retries: 3');
		});

		it('should use custom health check path', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				healthCheckPath: '/api/status',
			});

			expect(yaml).toContain('http://localhost:3000/api/status');
		});

		it('should use custom port', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				port: 8080,
			});

			expect(yaml).toContain('- "${PORT:-8080}:8080"');
			expect(yaml).toContain('http://localhost:8080/health');
		});

		it('should handle empty registry', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				registry: '',
			});

			expect(yaml).toContain('image: ${IMAGE_NAME:-my-api}:${TAG:-latest}');
			expect(yaml).not.toContain('${REGISTRY:-}');
		});

		it('should include build context and dockerfile', () => {
			const yaml = generateDockerCompose(baseOptions);

			expect(yaml).toContain('build:');
			expect(yaml).toContain('context: ../..');
			expect(yaml).toContain('dockerfile: .gkm/docker/Dockerfile');
		});

		it('should configure restart policy', () => {
			const yaml = generateDockerCompose(baseOptions);

			expect(yaml).toContain('restart: unless-stopped');
		});

		it('should attach to app-network', () => {
			const yaml = generateDockerCompose(baseOptions);

			expect(yaml).toContain('networks:');
			expect(yaml).toContain('- app-network');
		});
	});

	describe('postgres service', () => {
		it('should add DATABASE_URL environment variable', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: true },
			});

			expect(yaml).toContain(
				'- DATABASE_URL=${DATABASE_URL:-postgresql://postgres:postgres@postgres:5432/app}',
			);
		});

		it('should add postgres service definition with default version', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: true },
			});

			expect(yaml).toContain('postgres:');
			expect(yaml).toContain(`image: ${getDefaultImage('postgres')}`);
			expect(yaml).toContain('container_name: postgres');
		});

		it('should use custom postgres version', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: { version: '15-alpine' } },
			});

			expect(yaml).toContain('image: postgres:15-alpine');
		});

		it('should use custom postgres image (e.g., PostGIS)', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: { image: 'postgis/postgis:16-3.4-alpine' } },
			});

			expect(yaml).toContain('image: postgis/postgis:16-3.4-alpine');
		});

		it('should configure postgres environment variables', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: true },
			});

			expect(yaml).toContain('POSTGRES_USER: ${POSTGRES_USER:-postgres}');
			expect(yaml).toContain(
				'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}',
			);
			expect(yaml).toContain('POSTGRES_DB: ${POSTGRES_DB:-app}');
		});

		it('should add postgres volume', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: true },
			});

			expect(yaml).toContain('- postgres_data:/var/lib/postgresql/data');
			expect(yaml).toContain('postgres_data:');
		});

		it('should include postgres healthcheck', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: true },
			});

			expect(yaml).toContain('test: ["CMD-SHELL", "pg_isready -U postgres"]');
		});

		it('should add depends_on for postgres', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: true },
			});

			expect(yaml).toContain('depends_on:');
			expect(yaml).toContain('postgres:');
			expect(yaml).toContain('condition: service_healthy');
		});
	});

	describe('redis service', () => {
		it('should add REDIS_URL environment variable', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { redis: true },
			});

			expect(yaml).toContain('- REDIS_URL=${REDIS_URL:-redis://redis:6379}');
		});

		it('should add redis service definition with default version', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { redis: true },
			});

			expect(yaml).toContain('redis:');
			expect(yaml).toContain(`image: ${getDefaultImage('redis')}`);
			expect(yaml).toContain('container_name: redis');
		});

		it('should use custom redis version', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { redis: { version: '6-alpine' } },
			});

			expect(yaml).toContain('image: redis:6-alpine');
		});

		it('should use custom redis image (e.g., Redis Stack)', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { redis: { image: 'redis/redis-stack:latest' } },
			});

			expect(yaml).toContain('image: redis/redis-stack:latest');
		});

		it('should add redis volume', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { redis: true },
			});

			expect(yaml).toContain('- redis_data:/data');
			expect(yaml).toContain('redis_data:');
		});

		it('should include redis healthcheck', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { redis: true },
			});

			expect(yaml).toContain('test: ["CMD", "redis-cli", "ping"]');
		});
	});

	describe('rabbitmq service', () => {
		it('should add RABBITMQ_URL environment variable', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { rabbitmq: true },
			});

			expect(yaml).toContain(
				'- RABBITMQ_URL=${RABBITMQ_URL:-amqp://rabbitmq:5672}',
			);
		});

		it('should add rabbitmq service definition with default version', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { rabbitmq: true },
			});

			expect(yaml).toContain('rabbitmq:');
			expect(yaml).toContain(
				`image: rabbitmq:${DEFAULT_SERVICE_VERSIONS.rabbitmq}`,
			);
			expect(yaml).toContain('container_name: rabbitmq');
		});

		it('should use custom rabbitmq version', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { rabbitmq: { version: '3.12-management-alpine' } },
			});

			expect(yaml).toContain('image: rabbitmq:3.12-management-alpine');
		});

		it('should configure rabbitmq credentials', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { rabbitmq: true },
			});

			expect(yaml).toContain('RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-guest}');
			expect(yaml).toContain(
				'RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD:-guest}',
			);
		});

		it('should expose management UI port', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { rabbitmq: true },
			});

			expect(yaml).toContain('- "15672:15672"');
		});

		it('should add rabbitmq volume', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { rabbitmq: true },
			});

			expect(yaml).toContain('- rabbitmq_data:/var/lib/rabbitmq');
			expect(yaml).toContain('rabbitmq_data:');
		});

		it('should include rabbitmq healthcheck', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { rabbitmq: true },
			});

			expect(yaml).toContain(
				'test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]',
			);
		});
	});

	describe('multiple services', () => {
		it('should include all services when all specified', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: true, redis: true, rabbitmq: true },
			});

			expect(yaml).toContain('postgres:');
			expect(yaml).toContain('redis:');
			expect(yaml).toContain('rabbitmq:');
		});

		it('should add all environment variables', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: true, redis: true, rabbitmq: true },
			});

			expect(yaml).toContain('DATABASE_URL=');
			expect(yaml).toContain('REDIS_URL=');
			expect(yaml).toContain('RABBITMQ_URL=');
		});

		it('should add all volumes', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: true, redis: true, rabbitmq: true },
			});

			expect(yaml).toContain('postgres_data:');
			expect(yaml).toContain('redis_data:');
			expect(yaml).toContain('rabbitmq_data:');
		});

		it('should add depends_on for all services', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: true, redis: true, rabbitmq: true },
			});

			// Count occurrences of 'condition: service_healthy'
			const matches = yaml.match(/condition: service_healthy/g);
			expect(matches?.length).toBe(3);
		});

		it('should support mixed custom and default versions', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: {
					postgres: { version: '15-alpine' },
					redis: true,
					rabbitmq: { version: '3.12-management-alpine' },
				},
			});

			expect(yaml).toContain('image: postgres:15-alpine');
			expect(yaml).toContain(`image: redis:${DEFAULT_SERVICE_VERSIONS.redis}`);
			expect(yaml).toContain('image: rabbitmq:3.12-management-alpine');
		});
	});

	describe('legacy array format', () => {
		it('should support legacy array format with default versions', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: ['postgres', 'redis'],
			});

			expect(yaml).toContain('postgres:');
			expect(yaml).toContain('redis:');
			expect(yaml).toContain(
				`image: postgres:${DEFAULT_SERVICE_VERSIONS.postgres}`,
			);
			expect(yaml).toContain(`image: redis:${DEFAULT_SERVICE_VERSIONS.redis}`);
		});
	});

	describe('network configuration', () => {
		it('should define app-network with bridge driver', () => {
			const yaml = generateDockerCompose(baseOptions);

			expect(yaml).toContain('networks:');
			expect(yaml).toContain('app-network:');
			expect(yaml).toContain('driver: bridge');
		});

		it('should attach all services to app-network', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: true, redis: true },
			});

			// Should appear multiple times (api + postgres + redis)
			const networkMatches = yaml.match(/- app-network/g);
			expect(networkMatches?.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe('service exclusion', () => {
		it('should not include services set to false', () => {
			const yaml = generateDockerCompose({
				...baseOptions,
				services: { postgres: true, redis: false },
			});

			expect(yaml).toContain('postgres:');
			expect(yaml).not.toContain('image: redis:');
		});
	});
});

describe('generateMinimalDockerCompose', () => {
	const baseOptions = {
		imageName: 'minimal-api',
		registry: 'docker.io/myorg',
		port: 8080,
		healthCheckPath: '/status',
	};

	it('should generate valid docker-compose version', () => {
		const yaml = generateMinimalDockerCompose(baseOptions);

		expect(yaml).toContain("version: '3.8'");
	});

	it('should include only api service', () => {
		const yaml = generateMinimalDockerCompose(baseOptions);

		expect(yaml).toContain('api:');
		expect(yaml).not.toContain('postgres:');
		expect(yaml).not.toContain('redis:');
		expect(yaml).not.toContain('rabbitmq:');
	});

	it('should include correct image reference', () => {
		const yaml = generateMinimalDockerCompose(baseOptions);

		expect(yaml).toContain(
			'image: ${REGISTRY:-docker.io/myorg}/${IMAGE_NAME:-minimal-api}:${TAG:-latest}',
		);
	});

	it('should configure correct port', () => {
		const yaml = generateMinimalDockerCompose(baseOptions);

		expect(yaml).toContain('- "${PORT:-8080}:8080"');
	});

	it('should include health check with configured path', () => {
		const yaml = generateMinimalDockerCompose(baseOptions);

		expect(yaml).toContain('http://localhost:8080/status');
	});

	it('should not include volumes section', () => {
		const yaml = generateMinimalDockerCompose(baseOptions);

		expect(yaml).not.toContain('volumes:');
	});

	it('should not include depends_on', () => {
		const yaml = generateMinimalDockerCompose(baseOptions);

		expect(yaml).not.toContain('depends_on:');
	});

	it('should include network configuration', () => {
		const yaml = generateMinimalDockerCompose(baseOptions);

		expect(yaml).toContain('networks:');
		expect(yaml).toContain('app-network:');
		expect(yaml).toContain('driver: bridge');
	});

	it('should set NODE_ENV to production', () => {
		const yaml = generateMinimalDockerCompose(baseOptions);

		expect(yaml).toContain('- NODE_ENV=production');
	});

	it('should handle empty registry', () => {
		const yaml = generateMinimalDockerCompose({
			...baseOptions,
			registry: '',
		});

		expect(yaml).toContain('image: ${IMAGE_NAME:-minimal-api}:${TAG:-latest}');
	});
});

describe('generateWorkspaceCompose', () => {
	/** Create a minimal workspace config for testing */
	function createWorkspace(
		overrides: Partial<NormalizedWorkspace> = {},
	): NormalizedWorkspace {
		return {
			name: 'test-workspace',
			root: '/workspace',
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					dependencies: [],
				},
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3001,
					dependencies: ['api'],
					framework: 'nextjs',
				},
			},
			services: {},
			deploy: { default: 'dokploy' },
			shared: { packages: [] },
			secrets: {},
			...overrides,
		};
	}

	describe('header and structure', () => {
		it('should include workspace name in header comment', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('# Docker Compose for test-workspace workspace');
		});

		it('should include generated file warning', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('# Generated by gkm - do not edit manually');
		});

		it('should include services section', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('services:');
		});

		it('should include networks section', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('networks:');
			expect(yaml).toContain('workspace-network:');
			expect(yaml).toContain('driver: bridge');
		});
	});

	describe('app services', () => {
		it('should generate service for each app', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('api:');
			expect(yaml).toContain('web:');
		});

		it('should reference correct Dockerfile for each app', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('dockerfile: .gkm/docker/Dockerfile.api');
			expect(yaml).toContain('dockerfile: .gkm/docker/Dockerfile.web');
		});

		it('should set container name from app name', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('container_name: api');
			expect(yaml).toContain('container_name: web');
		});

		it('should configure port mapping for each app', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('"${API_PORT:-3000}:3000"');
			expect(yaml).toContain('"${WEB_PORT:-3001}:3001"');
		});

		it('should set PORT environment variable for each app', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('- PORT=3000');
			expect(yaml).toContain('- PORT=3001');
		});

		it('should set NODE_ENV to production for all apps', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			const matches = yaml.match(/- NODE_ENV=production/g);
			expect(matches?.length).toBe(2);
		});

		it('should configure restart policy for all apps', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			const matches = yaml.match(/restart: unless-stopped/g);
			expect(matches?.length).toBeGreaterThanOrEqual(2);
		});

		it('should attach all apps to workspace-network', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			const matches = yaml.match(/- workspace-network/g);
			expect(matches?.length).toBeGreaterThanOrEqual(2);
		});
	});

	describe('service discovery', () => {
		it('should add dependency URLs for frontend apps', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			// web depends on api, so should have API_URL
			expect(yaml).toContain('- API_URL=http://api:3000');
		});

		it('should handle multiple dependencies', () => {
			const workspace = createWorkspace({
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
					},
					auth: {
						type: 'backend',
						path: 'apps/auth',
						port: 3002,
						dependencies: [],
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						dependencies: ['api', 'auth'],
						framework: 'nextjs',
					},
				},
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('- API_URL=http://api:3000');
			expect(yaml).toContain('- AUTH_URL=http://auth:3002');
		});

		it('should not add dependency URLs for apps with no dependencies', () => {
			const workspace = createWorkspace({
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
					},
				},
			});
			const yaml = generateWorkspaceCompose(workspace);

			// api has no dependencies, so no *_URL vars
			expect(yaml).not.toMatch(/_URL=http:\/\//);
		});
	});

	describe('health checks', () => {
		it('should configure health check for backend apps at /health', () => {
			const workspace = createWorkspace({
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
					},
				},
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('http://localhost:3000/health');
		});

		it('should configure health check for frontend apps at /', () => {
			const workspace = createWorkspace({
				apps: {
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						dependencies: [],
						framework: 'nextjs',
					},
				},
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('http://localhost:3001/');
		});
	});

	describe('depends_on', () => {
		it('should add depends_on for app dependencies', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			// web depends on api
			expect(yaml).toContain('depends_on:');
			expect(yaml).toContain('condition: service_healthy');
		});

		it('should not add depends_on for apps without dependencies', () => {
			const workspace = createWorkspace({
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
					},
				},
			});
			const yaml = generateWorkspaceCompose(workspace);

			// api section should not have depends_on
			const apiSection = yaml.split('api:')[1]?.split(/^  \w+:/m)[0];
			expect(apiSection).not.toContain('depends_on:');
		});
	});

	describe('infrastructure services', () => {
		it('should add postgres service when db is configured', () => {
			const workspace = createWorkspace({
				services: { db: true },
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('postgres:');
			expect(yaml).toContain('image: postgres:16-alpine');
			expect(yaml).toContain('container_name: test-workspace-postgres');
		});

		it('should add DATABASE_URL for backend apps when postgres is enabled', () => {
			const workspace = createWorkspace({
				services: { db: true },
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain(
				'DATABASE_URL=${DATABASE_URL:-postgresql://postgres:postgres@postgres:5432/app}',
			);
		});

		it('should add redis service when cache is configured', () => {
			const workspace = createWorkspace({
				services: { cache: true },
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('redis:');
			expect(yaml).toContain('image: redis:7-alpine');
			expect(yaml).toContain('container_name: test-workspace-redis');
		});

		it('should add REDIS_URL for backend apps when redis is enabled', () => {
			const workspace = createWorkspace({
				services: { cache: true },
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('REDIS_URL=${REDIS_URL:-redis://redis:6379}');
		});

		it('should add mailpit service when mail is configured', () => {
			const workspace = createWorkspace({
				services: { mail: true },
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('mailpit:');
			expect(yaml).toContain('image: axllent/mailpit:latest');
			expect(yaml).toContain('- "8025:8025"'); // Web UI
			expect(yaml).toContain('- "1025:1025"'); // SMTP
		});

		it('should add postgres_data volume when postgres is enabled', () => {
			const workspace = createWorkspace({
				services: { db: true },
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('postgres_data:');
			expect(yaml).toContain('postgres_data:/var/lib/postgresql/data');
		});

		it('should add redis_data volume when redis is enabled', () => {
			const workspace = createWorkspace({
				services: { cache: true },
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('redis_data:');
			expect(yaml).toContain('redis_data:/data');
		});

		it('should include healthchecks for infrastructure services', () => {
			const workspace = createWorkspace({
				services: { db: true, cache: true },
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('pg_isready');
			expect(yaml).toContain('redis-cli');
		});

		it('should add depends_on for infrastructure services', () => {
			const workspace = createWorkspace({
				services: { db: true, cache: true },
			});
			const yaml = generateWorkspaceCompose(workspace);

			// Backend apps should depend on postgres and redis
			expect(yaml).toMatch(/postgres:\s+condition: service_healthy/);
			expect(yaml).toMatch(/redis:\s+condition: service_healthy/);
		});

		it('should not add infrastructure depends_on for frontend apps', () => {
			const workspace = createWorkspace({
				apps: {
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						dependencies: [],
						framework: 'nextjs',
					},
				},
				services: { db: true },
			});
			const yaml = generateWorkspaceCompose(workspace);

			// Frontend should not depend on postgres
			const webSection = yaml.split('web:')[1]?.split(/^  \w+:/m)[0];
			expect(webSection).not.toContain('postgres:');
		});

		it('should support custom postgres version', () => {
			const workspace = createWorkspace({
				services: { db: { version: '15-alpine' } },
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('image: postgres:15-alpine');
		});

		it('should support custom postgres image', () => {
			const workspace = createWorkspace({
				services: { db: { image: 'postgis/postgis:16-3.4-alpine' } },
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('image: postgis/postgis:16-3.4-alpine');
		});

		it('should support custom redis version', () => {
			const workspace = createWorkspace({
				services: { cache: { version: '6-alpine' } },
			});
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('image: redis:6-alpine');
		});
	});

	describe('registry configuration', () => {
		it('should include registry when provided', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace, {
				registry: 'ghcr.io/myorg',
			});

			expect(yaml).toContain('${REGISTRY:-ghcr.io/myorg}/');
		});

		it('should work without registry', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).not.toContain('${REGISTRY');
		});
	});

	describe('image naming', () => {
		it('should use app name for image with environment override', () => {
			const workspace = createWorkspace();
			const yaml = generateWorkspaceCompose(workspace);

			expect(yaml).toContain('${API_IMAGE:-api}:${TAG:-latest}');
			expect(yaml).toContain('${WEB_IMAGE:-web}:${TAG:-latest}');
		});
	});
});
