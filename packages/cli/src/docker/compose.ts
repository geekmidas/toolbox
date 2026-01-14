import type {
	ComposeServiceName,
	ComposeServicesConfig,
	ServiceConfig,
} from '../types';
import type {
	NormalizedAppConfig,
	NormalizedWorkspace,
	ServicesConfig,
} from '../workspace/types.js';

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

/**
 * Options for workspace compose generation.
 */
export interface WorkspaceComposeOptions {
	/** Container registry URL */
	registry?: string;
}

/**
 * Generate docker-compose.yml for a workspace with all apps as services.
 * Apps can communicate with each other via service names.
 * @internal Exported for testing
 */
export function generateWorkspaceCompose(
	workspace: NormalizedWorkspace,
	options: WorkspaceComposeOptions = {},
): string {
	const { registry } = options;
	const apps = Object.entries(workspace.apps);
	const services = workspace.services;

	// Determine which infrastructure services to include
	const hasPostgres = services.db !== undefined && services.db !== false;
	const hasRedis = services.cache !== undefined && services.cache !== false;
	const hasMail = services.mail !== undefined && services.mail !== false;

	// Get image versions from config
	const postgresImage = getInfraServiceImage('postgres', services.db);
	const redisImage = getInfraServiceImage('redis', services.cache);

	let yaml = `# Docker Compose for ${workspace.name} workspace
# Generated by gkm - do not edit manually

services:
`;

	// Generate service for each app
	for (const [appName, app] of apps) {
		yaml += generateAppService(appName, app, apps, {
			registry,
			hasPostgres,
			hasRedis,
		});
	}

	// Add infrastructure services
	if (hasPostgres) {
		yaml += `
  postgres:
    image: ${postgresImage}
    container_name: ${workspace.name}-postgres
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
      - workspace-network
`;
	}

	if (hasRedis) {
		yaml += `
  redis:
    image: ${redisImage}
    container_name: ${workspace.name}-redis
    restart: unless-stopped
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - workspace-network
`;
	}

	if (hasMail) {
		yaml += `
  mailpit:
    image: axllent/mailpit:latest
    container_name: ${workspace.name}-mailpit
    restart: unless-stopped
    ports:
      - "8025:8025"  # Web UI
      - "1025:1025"  # SMTP
    networks:
      - workspace-network
`;
	}

	// Add volumes section
	yaml += `
volumes:
`;

	if (hasPostgres) {
		yaml += `  postgres_data:
`;
	}

	if (hasRedis) {
		yaml += `  redis_data:
`;
	}

	// Add networks section
	yaml += `
networks:
  workspace-network:
    driver: bridge
`;

	return yaml;
}

/**
 * Get infrastructure service image with version.
 */
function getInfraServiceImage(
	serviceName: 'postgres' | 'redis',
	config: boolean | { version?: string; image?: string } | undefined,
): string {
	const defaults: Record<'postgres' | 'redis', string> = {
		postgres: 'postgres:16-alpine',
		redis: 'redis:7-alpine',
	};

	if (!config || config === true) {
		return defaults[serviceName];
	}

	if (typeof config === 'object') {
		if (config.image) {
			return config.image;
		}
		if (config.version) {
			const baseImage = serviceName === 'postgres' ? 'postgres' : 'redis';
			return `${baseImage}:${config.version}`;
		}
	}

	return defaults[serviceName];
}

/**
 * Generate a service definition for an app.
 */
function generateAppService(
	appName: string,
	app: NormalizedAppConfig,
	allApps: [string, NormalizedAppConfig][],
	options: {
		registry?: string;
		hasPostgres: boolean;
		hasRedis: boolean;
	},
): string {
	const { registry, hasPostgres, hasRedis } = options;
	const imageRef = registry ? `\${REGISTRY:-${registry}}/` : '';

	// Health check path - frontends use /, backends use /health
	const healthCheckPath = app.type === 'frontend' ? '/' : '/health';
	const healthCheckCmd =
		app.type === 'frontend'
			? `["CMD", "wget", "-q", "--spider", "http://localhost:${app.port}/"]`
			: `["CMD", "wget", "-q", "--spider", "http://localhost:${app.port}${healthCheckPath}"]`;

	let yaml = `
  ${appName}:
    build:
      context: .
      dockerfile: .gkm/docker/Dockerfile.${appName}
    image: ${imageRef}\${${appName.toUpperCase()}_IMAGE:-${appName}}:\${TAG:-latest}
    container_name: ${appName}
    restart: unless-stopped
    ports:
      - "\${${appName.toUpperCase()}_PORT:-${app.port}}:${app.port}"
    environment:
      - NODE_ENV=production
      - PORT=${app.port}
`;

	// Add dependency URLs - apps can reach other apps by service name
	for (const dep of app.dependencies) {
		const depApp = allApps.find(([name]) => name === dep)?.[1];
		if (depApp) {
			yaml += `      - ${dep.toUpperCase()}_URL=http://${dep}:${depApp.port}
`;
		}
	}

	// Add infrastructure service URLs for backend apps
	if (app.type === 'backend') {
		if (hasPostgres) {
			yaml += `      - DATABASE_URL=\${DATABASE_URL:-postgresql://postgres:postgres@postgres:5432/app}
`;
		}
		if (hasRedis) {
			yaml += `      - REDIS_URL=\${REDIS_URL:-redis://redis:6379}
`;
		}
	}

	yaml += `    healthcheck:
      test: ${healthCheckCmd}
      interval: 30s
      timeout: 3s
      retries: 3
`;

	// Add depends_on for dependencies and infrastructure
	const dependencies: string[] = [...app.dependencies];
	if (app.type === 'backend') {
		if (hasPostgres) dependencies.push('postgres');
		if (hasRedis) dependencies.push('redis');
	}

	if (dependencies.length > 0) {
		yaml += `    depends_on:
`;
		for (const dep of dependencies) {
			yaml += `      ${dep}:
        condition: service_healthy
`;
		}
	}

	yaml += `    networks:
      - workspace-network
`;

	return yaml;
}
