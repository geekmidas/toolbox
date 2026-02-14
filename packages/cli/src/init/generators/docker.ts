import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from '../templates/index.js';

export interface DatabaseAppConfig {
	name: string;
	password: string;
}

/**
 * Generate docker-compose.yml based on template and options
 */
export function generateDockerFiles(
	options: TemplateOptions,
	template: TemplateConfig,
	dbApps?: DatabaseAppConfig[],
): GeneratedFile[] {
	const { database } = options;
	const isServerless = template.name === 'serverless';
	const hasWorker = template.name === 'worker';
	const isFullstack = options.template === 'fullstack';

	const services: string[] = [];
	const volumes: string[] = [];
	const files: GeneratedFile[] = [];

	// PostgreSQL database
	if (database) {
		const initVolume =
			isFullstack && dbApps?.length
				? `
      - ./docker/postgres/init.sh:/docker-entrypoint-initdb.d/init.sh:ro`
				: '';

		const envFile =
			isFullstack && dbApps?.length
				? `
    env_file:
      - ./docker/.env`
				: '';

		services.push(`  postgres:
    image: postgres:16-alpine
    container_name: ${options.name}-postgres
    restart: unless-stopped${envFile}
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ${options.name.replace(/-/g, '_')}_dev
    ports:
      - '\${POSTGRES_HOST_PORT:-5432}:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data${initVolume}
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 5s
      timeout: 5s
      retries: 5`);
		volumes.push('  postgres_data:');

		// Generate PostgreSQL init script and .env for fullstack template
		if (isFullstack && dbApps?.length) {
			files.push({
				path: 'docker/postgres/init.sh',
				content: generatePostgresInitScript(dbApps),
			});

			// Generate .env file for docker-compose (contains db passwords)
			files.push({
				path: 'docker/.env',
				content: generateDockerEnv(dbApps),
			});
		}
	}

	// Redis - different setup for serverless vs standard
	if (isServerless) {
		// Use serverless-redis-http for Lambda compatibility
		services.push(`  redis:
    image: redis:7-alpine
    container_name: ${options.name}-redis
    restart: unless-stopped
    ports:
      - '\${REDIS_HOST_PORT:-6379}:6379'
    volumes:
      - redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 5

  serverless-redis:
    image: hiett/serverless-redis-http:latest
    container_name: ${options.name}-serverless-redis
    restart: unless-stopped
    ports:
      - '\${SRH_HOST_PORT:-8079}:80'
    environment:
      SRH_MODE: env
      SRH_TOKEN: local_dev_token
      SRH_CONNECTION_STRING: redis://redis:6379
    depends_on:
      redis:
        condition: service_healthy`);
		volumes.push('  redis_data:');
	} else {
		// Standard Redis for non-serverless templates
		services.push(`  redis:
    image: redis:7-alpine
    container_name: ${options.name}-redis
    restart: unless-stopped
    ports:
      - '\${REDIS_HOST_PORT:-6379}:6379'
    volumes:
      - redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 5`);
		volumes.push('  redis_data:');
	}

	// RabbitMQ for worker template
	if (hasWorker) {
		services.push(`  rabbitmq:
    image: rabbitmq:3-management-alpine
    container_name: ${options.name}-rabbitmq
    restart: unless-stopped
    ports:
      - '\${RABBITMQ_HOST_PORT:-5672}:5672'
      - '\${RABBITMQ_MGMT_HOST_PORT:-15672}:15672'
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    healthcheck:
      test: ['CMD', 'rabbitmq-diagnostics', 'check_running']
      interval: 10s
      timeout: 5s
      retries: 5`);
		volumes.push('  rabbitmq_data:');
	}

	// Mailpit for email testing
	if (options.services?.mail) {
		services.push(`  mailpit:
    image: axllent/mailpit:latest
    container_name: ${options.name}-mailpit
    restart: unless-stopped
    ports:
      - '\${MAILPIT_SMTP_HOST_PORT:-1025}:1025'
      - '\${MAILPIT_UI_HOST_PORT:-8025}:8025'
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: 1
      MP_SMTP_AUTH_ALLOW_INSECURE: 1`);
	}

	// Build docker-compose.yml
	let dockerCompose = `services:
${services.join('\n\n')}
`;

	if (volumes.length > 0) {
		dockerCompose += `
volumes:
${volumes.join('\n')}
`;
	}

	// Add docker-compose.yml to files
	files.push({
		path: 'docker-compose.yml',
		content: dockerCompose,
	});

	return files;
}

/**
 * Generate .env file for docker-compose with database passwords
 */
function generateDockerEnv(apps: DatabaseAppConfig[]): string {
	const envVars = apps.map((app) => {
		const envVar = `${app.name.toUpperCase()}_DB_PASSWORD`;
		return `${envVar}=${app.password}`;
	});

	return `# Auto-generated docker environment file
# Contains database passwords for docker-compose postgres init
# This file is gitignored - do not commit to version control
${envVars.join('\n')}
`;
}

/**
 * Generate PostgreSQL init shell script that creates per-app users with separate schemas
 * Uses environment variables for passwords (more secure than hardcoded values)
 * - api user: uses public schema
 * - auth user: uses auth schema with search_path=auth
 */
function generatePostgresInitScript(apps: DatabaseAppConfig[]): string {
	const userCreations = apps.map((app) => {
		const userName = app.name.replace(/-/g, '_');
		const envVar = `${app.name.toUpperCase()}_DB_PASSWORD`;
		const isApi = app.name === 'api';
		const schemaName = isApi ? 'public' : userName;

		if (isApi) {
			// API user uses public schema
			return `
# Create ${app.name} user (uses public schema)
echo "Creating user ${userName}..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER ${userName} WITH PASSWORD '$${envVar}';
    GRANT ALL ON SCHEMA public TO ${userName};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${userName};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${userName};
EOSQL
`;
		}
		// Other users get their own schema with search_path
		return `
# Create ${app.name} user with dedicated schema
echo "Creating user ${userName} with schema ${schemaName}..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER ${userName} WITH PASSWORD '$${envVar}';
    CREATE SCHEMA ${schemaName} AUTHORIZATION ${userName};
    ALTER USER ${userName} SET search_path TO ${schemaName};
    GRANT USAGE ON SCHEMA ${schemaName} TO ${userName};
    GRANT ALL ON ALL TABLES IN SCHEMA ${schemaName} TO ${userName};
    GRANT ALL ON ALL SEQUENCES IN SCHEMA ${schemaName} TO ${userName};
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName} GRANT ALL ON TABLES TO ${userName};
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName} GRANT ALL ON SEQUENCES TO ${userName};
EOSQL
`;
	});

	return `#!/bin/bash
set -e

# Auto-generated PostgreSQL init script
# Creates per-app users with separate schemas in a single database
# - api: uses public schema
# - auth: uses auth schema (search_path=auth)
${userCreations.join('\n')}
echo "Database initialization complete!"
`;
}
