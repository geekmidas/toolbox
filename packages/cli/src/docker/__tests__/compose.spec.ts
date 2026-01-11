import { describe, expect, it } from 'vitest';
import {
	type ComposeOptions,
	DEFAULT_SERVICE_IMAGES,
	DEFAULT_SERVICE_VERSIONS,
	generateDockerCompose,
	generateMinimalDockerCompose,
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
