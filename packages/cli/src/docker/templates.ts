import type { DockerConfig, GkmConfig } from '../types';

export interface DockerTemplateOptions {
  imageName: string;
  baseImage: string;
  port: number;
  healthCheckPath: string;
  /** Whether the build is pre-built (slim Dockerfile) or needs building */
  prebuilt: boolean;
}

/**
 * Generate a multi-stage Dockerfile for building from source
 */
export function generateMultiStageDockerfile(
  options: DockerTemplateOptions,
): string {
  const { baseImage, port, healthCheckPath } = options;

  return `# Stage 1: Build
FROM ${baseImage} AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build production server
RUN pnpm gkm build --provider server --production

# Stage 2: Production
FROM ${baseImage} AS runner

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 hono

# Copy bundled server
COPY --from=builder --chown=hono:nodejs /app/.gkm/server/dist/server.mjs ./

# Environment
ENV NODE_ENV=production
ENV PORT=${port}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget -q --spider http://localhost:${port}${healthCheckPath} || exit 1

# Switch to non-root user
USER hono

EXPOSE ${port}

CMD ["node", "server.mjs"]
`;
}

/**
 * Generate a slim Dockerfile for pre-built bundles
 */
export function generateSlimDockerfile(options: DockerTemplateOptions): string {
  const { baseImage, port, healthCheckPath } = options;

  return `# Slim Dockerfile for pre-built production bundle
FROM ${baseImage}

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 hono

# Copy pre-built bundle
COPY .gkm/server/dist/server.mjs ./

# Environment
ENV NODE_ENV=production
ENV PORT=${port}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget -q --spider http://localhost:${port}${healthCheckPath} || exit 1

# Switch to non-root user
USER hono

EXPOSE ${port}

CMD ["node", "server.mjs"]
`;
}

/**
 * Generate .dockerignore file
 */
export function generateDockerignore(): string {
  return `# Dependencies
node_modules
.pnpm-store

# Build output (except what we need)
.gkm/aws*
.gkm/server/*.ts
!.gkm/server/dist

# IDE and editor
.idea
.vscode
*.swp
*.swo

# Git
.git
.gitignore

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Test files
**/*.test.ts
**/*.spec.ts
**/__tests__
coverage

# Documentation
docs
*.md
!README.md

# Environment files (handle secrets separately)
.env
.env.*
!.env.example

# Docker files (don't copy recursively)
Dockerfile*
docker-compose*
.dockerignore
`;
}

/**
 * Generate docker-entrypoint.sh for custom startup logic
 */
export function generateDockerEntrypoint(): string {
  return `#!/bin/sh
set -e

# Run any custom startup scripts here
# Example: wait for database
# until nc -z $DB_HOST $DB_PORT; do
#   echo "Waiting for database..."
#   sleep 1
# done

# Execute the main command
exec "$@"
`;
}

/**
 * Resolve Docker configuration from GkmConfig with defaults
 */
export function resolveDockerConfig(
  config: GkmConfig,
): Required<Omit<DockerConfig, 'compose'>> & Pick<DockerConfig, 'compose'> {
  const docker = config.docker ?? {};

  // Try to get image name from package.json name
  let defaultImageName = 'api';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require(`${process.cwd()}/package.json`);
    if (pkg.name) {
      // Remove scope and use just the package name
      defaultImageName = pkg.name.replace(/^@[^/]+\//, '');
    }
  } catch {
    // Ignore if package.json doesn't exist
  }

  return {
    registry: docker.registry ?? '',
    imageName: docker.imageName ?? defaultImageName,
    baseImage: docker.baseImage ?? 'node:22-alpine',
    port: docker.port ?? 3000,
    compose: docker.compose,
  };
}
