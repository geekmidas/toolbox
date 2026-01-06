export interface ComposeOptions {
  imageName: string;
  registry: string;
  port: number;
  healthCheckPath: string;
  services: ('postgres' | 'redis' | 'rabbitmq')[];
}

/**
 * Generate docker-compose.yml for production deployment
 */
export function generateDockerCompose(options: ComposeOptions): string {
  const { imageName, registry, port, healthCheckPath, services } = options;

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
  if (services.includes('postgres')) {
    yaml += `      - DATABASE_URL=\${DATABASE_URL:-postgresql://postgres:postgres@postgres:5432/app}
`;
  }

  if (services.includes('redis')) {
    yaml += `      - REDIS_URL=\${REDIS_URL:-redis://redis:6379}
`;
  }

  if (services.includes('rabbitmq')) {
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
  if (services.length > 0) {
    yaml += `    depends_on:
`;
    for (const service of services) {
      yaml += `      ${service}:
        condition: service_healthy
`;
    }
  }

  yaml += `    networks:
      - app-network
`;

  // Add service definitions
  if (services.includes('postgres')) {
    yaml += `
  postgres:
    image: postgres:16-alpine
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

  if (services.includes('redis')) {
    yaml += `
  redis:
    image: redis:7-alpine
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

  if (services.includes('rabbitmq')) {
    yaml += `
  rabbitmq:
    image: rabbitmq:3-management-alpine
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

  if (services.includes('postgres')) {
    yaml += `  postgres_data:
`;
  }

  if (services.includes('redis')) {
    yaml += `  redis_data:
`;
  }

  if (services.includes('rabbitmq')) {
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
