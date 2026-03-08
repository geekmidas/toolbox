import type {
	ComposeServiceName,
	ComposeServicesConfig,
	ServiceConfig,
} from '../types';
import type {
	NormalizedAppConfig,
	NormalizedWorkspace,
} from '../workspace/types.js';

/** Default Docker images for services */
export const DEFAULT_SERVICE_IMAGES: Record<ComposeServiceName, string> = {
	postgres: 'postgres',
	redis: 'redis',
	rabbitmq: 'rabbitmq',
	minio: 'minio/minio',
	mailpit: 'axllent/mailpit',
	localstack: 'localstack/localstack',
};

/** Default Docker image versions for services */
export const DEFAULT_SERVICE_VERSIONS: Record<ComposeServiceName, string> = {
	postgres: '18-alpine',
	redis: '7-alpine',
	rabbitmq: '3-management-alpine',
	minio: 'latest',
	mailpit: 'latest',
	localstack: 'latest',
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

	let yaml = `# Use "gkm dev" or "gkm test" to start services.
# Running "docker compose up" directly will not inject secrets or resolve ports.
version: '3.8'

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
		yaml += `      - DATABASE_URL=\${DATABASE_URL:-postgresql://\${POSTGRES_USER:-postgres}:\${POSTGRES_PASSWORD:-postgres}@postgres:5432/\${POSTGRES_DB:-app}}
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

	if (serviceMap.has('minio')) {
		yaml += `      - STORAGE_ENDPOINT=\${STORAGE_ENDPOINT:-http://minio:9000}
      - STORAGE_ACCESS_KEY_ID=\${STORAGE_ACCESS_KEY_ID:-${imageName}}
      - STORAGE_SECRET_ACCESS_KEY=\${STORAGE_SECRET_ACCESS_KEY:-${imageName}}
      - STORAGE_BUCKET=\${STORAGE_BUCKET:-${imageName}}
      - STORAGE_REGION=\${STORAGE_REGION:-eu-west-1}
      - STORAGE_FORCE_PATH_STYLE=true
`;
	}

	if (serviceMap.has('mailpit')) {
		yaml += `      - SMTP_HOST=\${SMTP_HOST:-mailpit}
      - SMTP_PORT=\${SMTP_PORT:-1025}
      - SMTP_USER=\${SMTP_USER:-${imageName}}
      - SMTP_PASS=\${SMTP_PASS:-${imageName}}
      - SMTP_SECURE=\${SMTP_SECURE:-false}
      - MAIL_FROM=\${MAIL_FROM:-noreply@localhost}
`;
	}

	if (serviceMap.has('localstack')) {
		yaml += `      - AWS_ACCESS_KEY_ID=\${AWS_ACCESS_KEY_ID:-localstack}
      - AWS_SECRET_ACCESS_KEY=\${AWS_SECRET_ACCESS_KEY:-localstack}
      - AWS_REGION=\${AWS_REGION:-us-east-1}
      - AWS_ENDPOINT_URL=\${AWS_ENDPOINT_URL:-http://localstack:4566}
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
      - dbdata:/var/lib/postgresql/18/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER"]
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

	const minioImage = serviceMap.get('minio');
	if (minioImage) {
		yaml += `
  minio:
    image: ${minioImage}
    container_name: minio
    restart: unless-stopped
    entrypoint: sh
    command: -c 'mkdir -p /data/\${STORAGE_BUCKET:-${imageName}} && /usr/bin/docker-entrypoint.sh server --console-address ":9001" /data'
    environment:
      MINIO_ROOT_USER: \${STORAGE_ACCESS_KEY_ID:-${imageName}}
      MINIO_ROOT_PASSWORD: \${STORAGE_SECRET_ACCESS_KEY:-${imageName}}
    ports:
      - "\${MINIO_API_PORT:-9000}:9000"
      - "\${MINIO_CONSOLE_PORT:-9001}:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - app-network
`;
	}

	const mailpitImage = serviceMap.get('mailpit');
	if (mailpitImage) {
		yaml += `
  mailpit:
    image: ${mailpitImage}
    container_name: mailpit
    restart: unless-stopped
    environment:
      MP_SMTP_AUTH: \${SMTP_USER:-${imageName}}:\${SMTP_PASS:-${imageName}}
    ports:
      - "\${MAILPIT_PORT:-8025}:8025"  # Web UI / API
      - "\${SMTP_PORT:-1025}:1025"  # SMTP
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8025"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - app-network
`;
	}

	const localstackImage = serviceMap.get('localstack');
	if (localstackImage) {
		yaml += `
  localstack:
    image: ${localstackImage}
    container_name: localstack
    restart: unless-stopped
    environment:
      SERVICES: sns,sqs
      AWS_DEFAULT_REGION: \${AWS_REGION:-us-east-1}
      AWS_ACCESS_KEY_ID: \${AWS_ACCESS_KEY_ID:-localstack}
      AWS_SECRET_ACCESS_KEY: \${AWS_SECRET_ACCESS_KEY:-localstack}
    ports:
      - "\${LOCALSTACK_PORT:-4566}:4566"
    volumes:
      - localstack_data:/var/lib/localstack
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4566/_localstack/health"]
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
		yaml += `  dbdata:
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

	if (serviceMap.has('minio')) {
		yaml += `  minio_data:
`;
	}

	if (serviceMap.has('localstack')) {
		yaml += `  localstack_data:
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

	return `# Use "gkm dev" or "gkm test" to start services.
# Running "docker compose up" directly will not inject secrets or resolve ports.
version: '3.8'

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
	const hasMinio = services.storage !== undefined && services.storage !== false;

	// Get image versions from config
	const postgresImage = getInfraServiceImage('postgres', services.db);
	const redisImage = getInfraServiceImage('redis', services.cache);
	const minioImage = getInfraServiceImage('minio', services.storage);

	let yaml = `# Docker Compose for ${workspace.name} workspace
# Use "gkm dev" or "gkm test" to start services.
# Running "docker compose up" directly will not inject secrets or resolve ports.

services:
`;

	// Generate service for each app
	for (const [appName, app] of apps) {
		yaml += generateAppService(appName, app, apps, {
			registry,
			projectName: workspace.name,
			hasPostgres,
			hasRedis,
			hasMinio,
			hasMail,
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
      - dbdata:/var/lib/postgresql/18/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER"]
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
    environment:
      MP_SMTP_AUTH: \${SMTP_USER:-${workspace.name}}:\${SMTP_PASS:-${workspace.name}}
    ports:
      - "\${MAILPIT_PORT:-8025}:8025"  # Web UI / API
      - "\${SMTP_PORT:-1025}:1025"  # SMTP
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8025"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - workspace-network
`;
	}

	if (hasMinio) {
		yaml += `
  minio:
    image: ${minioImage}
    container_name: ${workspace.name}-minio
    restart: unless-stopped
    entrypoint: sh
    command: -c 'mkdir -p /data/\${STORAGE_BUCKET:-${workspace.name}} && /usr/bin/docker-entrypoint.sh server --console-address ":9001" /data'
    environment:
      MINIO_ROOT_USER: \${STORAGE_ACCESS_KEY_ID:-${workspace.name}}
      MINIO_ROOT_PASSWORD: \${STORAGE_SECRET_ACCESS_KEY:-${workspace.name}}
    ports:
      - "\${MINIO_API_PORT:-9000}:9000"
      - "\${MINIO_CONSOLE_PORT:-9001}:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - workspace-network
`;
	}

	// Add volumes section
	yaml += `
volumes:
`;

	if (hasPostgres) {
		yaml += `  dbdata:
`;
	}

	if (hasRedis) {
		yaml += `  redis_data:
`;
	}

	if (hasMinio) {
		yaml += `  minio_data:
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
	serviceName: 'postgres' | 'redis' | 'minio',
	config: boolean | { version?: string; image?: string } | undefined,
): string {
	const defaults: Record<'postgres' | 'redis' | 'minio', string> = {
		postgres: 'postgres:18-alpine',
		redis: 'redis:7-alpine',
		minio: 'minio/minio:latest',
	};

	if (!config || config === true) {
		return defaults[serviceName];
	}

	if (typeof config === 'object') {
		if (config.image) {
			return config.image;
		}
		if (config.version) {
			const baseImages: Record<'postgres' | 'redis' | 'minio', string> = {
				postgres: 'postgres',
				redis: 'redis',
				minio: 'minio/minio',
			};
			return `${baseImages[serviceName]}:${config.version}`;
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
		projectName: string;
		hasPostgres: boolean;
		hasRedis: boolean;
		hasMinio: boolean;
		hasMail: boolean;
		eventsBackend?: import('../types').EventsBackend;
	},
): string {
	const {
		registry,
		projectName,
		hasPostgres,
		hasRedis,
		hasMinio,
		hasMail,
		eventsBackend,
	} = options;
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
			yaml += `      - DATABASE_URL=\${DATABASE_URL:-postgresql://\${POSTGRES_USER:-postgres}:\${POSTGRES_PASSWORD:-postgres}@postgres:5432/\${POSTGRES_DB:-app}}
`;
		}
		if (hasRedis) {
			yaml += `      - REDIS_URL=\${REDIS_URL:-redis://redis:6379}
`;
		}
		if (hasMinio) {
			yaml += `      - STORAGE_ENDPOINT=\${STORAGE_ENDPOINT:-http://minio:9000}
      - STORAGE_ACCESS_KEY_ID=\${STORAGE_ACCESS_KEY_ID:-${projectName}}
      - STORAGE_SECRET_ACCESS_KEY=\${STORAGE_SECRET_ACCESS_KEY:-${projectName}}
      - STORAGE_BUCKET=\${STORAGE_BUCKET:-${projectName}}
      - STORAGE_REGION=\${STORAGE_REGION:-eu-west-1}
      - STORAGE_FORCE_PATH_STYLE=true
`;
		}
		if (hasMail) {
			yaml += `      - SMTP_HOST=\${SMTP_HOST:-mailpit}
      - SMTP_PORT=\${SMTP_PORT:-1025}
      - SMTP_USER=\${SMTP_USER:-${projectName}}
      - SMTP_PASS=\${SMTP_PASS:-${projectName}}
      - SMTP_SECURE=\${SMTP_SECURE:-false}
      - MAIL_FROM=\${MAIL_FROM:-noreply@localhost}
`;
		}
		if (eventsBackend) {
			yaml += `      - EVENT_PUBLISHER_CONNECTION_STRING=\${EVENT_PUBLISHER_CONNECTION_STRING}
      - EVENT_SUBSCRIBER_CONNECTION_STRING=\${EVENT_SUBSCRIBER_CONNECTION_STRING}
`;
			if (eventsBackend === 'sns') {
				yaml += `      - AWS_ACCESS_KEY_ID=\${AWS_ACCESS_KEY_ID:-localstack}
      - AWS_SECRET_ACCESS_KEY=\${AWS_SECRET_ACCESS_KEY:-localstack}
      - AWS_REGION=\${AWS_REGION:-us-east-1}
      - AWS_ENDPOINT_URL=\${AWS_ENDPOINT_URL:-http://localstack:4566}
`;
			}
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
		if (hasMinio) dependencies.push('minio');
		if (hasMail) dependencies.push('mailpit');
		if (eventsBackend === 'sns') dependencies.push('localstack');
		if (eventsBackend === 'rabbitmq') dependencies.push('rabbitmq');
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
