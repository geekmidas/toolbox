import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from '../templates/index.js';

/**
 * Generate docker-compose.yml based on template and options
 */
export function generateDockerFiles(
	options: TemplateOptions,
	template: TemplateConfig,
): GeneratedFile[] {
	const { database } = options;
	const isServerless = template.name === 'serverless';
	const hasWorker = template.name === 'worker';

	const services: string[] = [];
	const volumes: string[] = [];

	// PostgreSQL database
	if (database) {
		services.push(`  postgres:
    image: postgres:16-alpine
    container_name: ${options.name}-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ${options.name.replace(/-/g, '_')}_dev
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 5s
      timeout: 5s
      retries: 5`);
		volumes.push('  postgres_data:');
	}

	// Redis - different setup for serverless vs standard
	if (isServerless) {
		// Use serverless-redis-http for Lambda compatibility
		services.push(`  redis:
    image: redis:7-alpine
    container_name: ${options.name}-redis
    restart: unless-stopped
    ports:
      - '6379:6379'
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
      - '8079:80'
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
      - '6379:6379'
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
      - '5672:5672'
      - '15672:15672'
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

	// Build docker-compose.yml
	let dockerCompose = `version: '3.8'

services:
${services.join('\n\n')}
`;

	if (volumes.length > 0) {
		dockerCompose += `
volumes:
${volumes.join('\n')}
`;
	}

	return [
		{
			path: 'docker-compose.yml',
			content: dockerCompose,
		},
	];
}
