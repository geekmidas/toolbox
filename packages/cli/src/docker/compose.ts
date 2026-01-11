import type {
	ComposeServiceName,
	ComposeServicesConfig,
	ServiceConfig,
} from '../types';

/** Default Docker images for services */
export const DEFAULT_SERVICE_IMAGES: Record<ComposeServiceName, string> = {
	postgres: 'postgres',
	redis: 'redis',
	rabbitmq: 'rabbitmq',
};

/** Default Docker image versions for services */
export const DEFAULT_SERVICE_VERSIONS: Record<ComposeServiceName, string> = {
	postgres: '16-alpine',
	redis: '7-alpine',
	rabbitmq: '3-management-alpine',
};

export interface ComposeOptions {
	imageName: string;
	registry: string;
	port: number;
	healthCheckPath: string;
	/** Services config - object format or legacy array format */
	services: ComposeServicesConfig | ComposeServiceName[];
}

/** Get the default full image reference for a service */
function getDefaultImage(serviceName: ComposeServiceName): string {
	return `${DEFAULT_SERVICE_IMAGES[serviceName]}:${DEFAULT_SERVICE_VERSIONS[serviceName]}`;
}

/** Normalize services config to a consistent format - returns Map of service name to full image reference */
function normalizeServices(
	services: ComposeServicesConfig | ComposeServiceName[],
): Map<ComposeServiceName, string> {
	const result = new Map<ComposeServiceName, string>();

	if (Array.isArray(services)) {
		// Legacy array format - use default images
		for (const name of services) {
			result.set(name, getDefaultImage(name));
		}
	} else {
		// Object format
		for (const [name, config] of Object.entries(services)) {
			const serviceName = name as ComposeServiceName;
			if (config === true) {
				// boolean true - use default image
				result.set(serviceName, getDefaultImage(serviceName));
			} else if (config && typeof config === 'object') {
				const serviceConfig = config as ServiceConfig;
				if (serviceConfig.image) {
					// Full image reference provided
					result.set(serviceName, serviceConfig.image);
				} else {
					// Version only - use default image name with custom version
					const version =
						serviceConfig.version ?? DEFAULT_SERVICE_VERSIONS[serviceName];
					result.set(
						serviceName,
						`${DEFAULT_SERVICE_IMAGES[serviceName]}:${version}`,
					);
				}
			}
			// false or undefined - skip
		}
	}

	return result;
}

/**
 * Generate docker-compose.yml for production deployment
 */
export function generateDockerCompose(options: ComposeOptions): string {
	const { imageName, registry, port, healthCheckPath, services } = options;

	// Normalize services to Map<name, version>
	const serviceMap = normalizeServices(services);

	const imageRef = registry ? `\${REGISTRY:-${registry}}/` : '';

	let yaml = `version: '3.8'

services:
  api:
    build:
      context: ../..
      dockerfile: .gkm/docker/Dockerfile
    image: ${imageRef}\${IMAGE_NAME:-${imageName}}:\${TAG:-latest}
    container_name: ${imageName}
    restart: unless-stopped
    ports:
      - "\${PORT:-${port}}:${port}"
    environment:
      - NODE_ENV=production
`;

	// Add environment variables based on services
	if (serviceMap.has('postgres')) {
		yaml += `      - DATABASE_URL=\${DATABASE_URL:-postgresql://postgres:postgres@postgres:5432/app}
`;
	}

	if (serviceMap.has('redis')) {
		yaml += `      - REDIS_URL=\${REDIS_URL:-redis://redis:6379}
`;
	}

	if (serviceMap.has('rabbitmq')) {
		yaml += `      - RABBITMQ_URL=\${RABBITMQ_URL:-amqp://rabbitmq:5672}
`;
	}

	yaml += `    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:${port}${healthCheckPath}"]
      interval: 30s
      timeout: 3s
      retries: 3
`;

	// Add depends_on if there are services
	if (serviceMap.size > 0) {
		yaml += `    depends_on:
`;
		for (const serviceName of serviceMap.keys()) {
			yaml += `      ${serviceName}:
        condition: service_healthy
`;
		}
	}

	yaml += `    networks:
      - app-network
`;

	// Add service definitions with images
	const postgresImage = serviceMap.get('postgres');
	if (postgresImage) {
		yaml += `
  postgres:
    image: ${postgresImage}
    container_name: postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: \${POSTGRES_DB:-app}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - app-network
`;
	}

	const redisImage = serviceMap.get('redis');
	if (redisImage) {
		yaml += `
  redis:
    image: ${redisImage}
    container_name: redis
    restart: unless-stopped
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - app-network
`;
	}

	const rabbitmqImage = serviceMap.get('rabbitmq');
	if (rabbitmqImage) {
		yaml += `
  rabbitmq:
    image: ${rabbitmqImage}
    container_name: rabbitmq
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: \${RABBITMQ_USER:-guest}
      RABBITMQ_DEFAULT_PASS: \${RABBITMQ_PASSWORD:-guest}
    ports:
      - "15672:15672"  # Management UI
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - app-network
`;
	}

	// Add volumes
	yaml += `
volumes:
`;

	if (serviceMap.has('postgres')) {
		yaml += `  postgres_data:
`;
	}

	if (serviceMap.has('redis')) {
		yaml += `  redis_data:
`;
	}

	if (serviceMap.has('rabbitmq')) {
		yaml += `  rabbitmq_data:
`;
	}

	// Add networks
	yaml += `
networks:
  app-network:
    driver: bridge
`;

	return yaml;
}

/**
 * Generate a minimal docker-compose.yml for API only
 */
export function generateMinimalDockerCompose(
	options: Omit<ComposeOptions, 'services'>,
): string {
	const { imageName, registry, port, healthCheckPath } = options;

	const imageRef = registry ? `\${REGISTRY:-${registry}}/` : '';

	return `version: '3.8'

services:
  api:
    build:
      context: ../..
      dockerfile: .gkm/docker/Dockerfile
    image: ${imageRef}\${IMAGE_NAME:-${imageName}}:\${TAG:-latest}
    container_name: ${imageName}
    restart: unless-stopped
    ports:
      - "\${PORT:-${port}}:${port}"
    environment:
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:${port}${healthCheckPath}"]
      interval: 30s
      timeout: 3s
      retries: 3
    networks:
      - app-network

networks:
  app-network:
    driver: bridge
`;
}
