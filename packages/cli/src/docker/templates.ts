import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DockerConfig, GkmConfig } from '../types';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

export interface DockerTemplateOptions {
  imageName: string;
  baseImage: string;
  port: number;
  healthCheckPath: string;
  /** Whether the build is pre-built (slim Dockerfile) or needs building */
  prebuilt: boolean;
  /** Detected package manager */
  packageManager: PackageManager;
}

export interface MultiStageDockerfileOptions extends DockerTemplateOptions {
  /** Enable turbo prune for monorepo optimization */
  turbo?: boolean;
  /** Package name for turbo prune (defaults to current directory name) */
  turboPackage?: string;
}

/**
 * Detect package manager from lockfiles
 */
export function detectPackageManager(
  cwd: string = process.cwd(),
): PackageManager {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'bun.lockb'))) return 'bun';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm';
  return 'pnpm'; // default
}

/**
 * Get package manager specific commands and paths
 */
function getPmConfig(pm: PackageManager) {
  const configs = {
    pnpm: {
      install: 'corepack enable && corepack prepare pnpm@latest --activate',
      lockfile: 'pnpm-lock.yaml',
      fetch: 'pnpm fetch',
      installCmd: 'pnpm install --frozen-lockfile --offline',
      cacheTarget: '/root/.local/share/pnpm/store',
      cacheId: 'pnpm',
      run: 'pnpm',
      addGlobal: 'pnpm add -g',
    },
    npm: {
      install: '', // npm comes with node
      lockfile: 'package-lock.json',
      fetch: '', // npm doesn't have fetch
      installCmd: 'npm ci',
      cacheTarget: '/root/.npm',
      cacheId: 'npm',
      run: 'npm run',
      addGlobal: 'npm install -g',
    },
    yarn: {
      install: 'corepack enable && corepack prepare yarn@stable --activate',
      lockfile: 'yarn.lock',
      fetch: '', // yarn doesn't have fetch
      installCmd: 'yarn install --frozen-lockfile',
      cacheTarget: '/root/.yarn/cache',
      cacheId: 'yarn',
      run: 'yarn',
      addGlobal: 'yarn global add',
    },
    bun: {
      install: 'npm install -g bun',
      lockfile: 'bun.lockb',
      fetch: '', // bun doesn't have fetch
      installCmd: 'bun install --frozen-lockfile',
      cacheTarget: '/root/.bun/install/cache',
      cacheId: 'bun',
      run: 'bun run',
      addGlobal: 'bun add -g',
    },
  };
  return configs[pm];
}

/**
 * Generate a multi-stage Dockerfile for building from source
 * Optimized for build speed with:
 * - BuildKit cache mounts for package manager store
 * - pnpm fetch for better layer caching (when using pnpm)
 * - Optional turbo prune for monorepos
 */
export function generateMultiStageDockerfile(
  options: MultiStageDockerfileOptions,
): string {
  const {
    baseImage,
    port,
    healthCheckPath,
    turbo,
    turboPackage,
    packageManager,
  } = options;

  if (turbo) {
    return generateTurboDockerfile({
      ...options,
      turboPackage: turboPackage ?? 'api',
    });
  }

  const pm = getPmConfig(packageManager);
  const installPm = pm.install
    ? `\n# Install ${packageManager}\nRUN ${pm.install}\n`
    : '';
  const hasFetch = packageManager === 'pnpm';

  // pnpm has fetch which allows better caching
  const depsStage = hasFetch
    ? `# Copy lockfile first for better caching
COPY ${pm.lockfile} ./

# Fetch dependencies (downloads to virtual store, cached separately)
RUN --mount=type=cache,id=${pm.cacheId},target=${pm.cacheTarget} \\
    ${pm.fetch}

# Copy package.json after fetch
COPY package.json ./

# Install from cache (fast - no network needed)
RUN --mount=type=cache,id=${pm.cacheId},target=${pm.cacheTarget} \\
    ${pm.installCmd}`
    : `# Copy package files
COPY package.json ${pm.lockfile} ./

# Install dependencies with cache
RUN --mount=type=cache,id=${pm.cacheId},target=${pm.cacheTarget} \\
    ${pm.installCmd}`;

  return `# syntax=docker/dockerfile:1
# Stage 1: Dependencies
FROM ${baseImage} AS deps

WORKDIR /app
${installPm}
${depsStage}

# Stage 2: Build
FROM deps AS builder

WORKDIR /app

# Copy source (deps already installed)
COPY . .

# Build production server
RUN ${pm.run} gkm build --provider server --production

# Stage 3: Production
FROM ${baseImage} AS runner

WORKDIR /app

# Install tini for proper signal handling as PID 1
RUN apk add --no-cache tini

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

# Use tini as entrypoint to handle PID 1 responsibilities
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.mjs"]
`;
}

/**
 * Generate a Dockerfile optimized for Turbo monorepos
 * Uses turbo prune to create minimal Docker context
 */
function generateTurboDockerfile(options: MultiStageDockerfileOptions): string {
  const { baseImage, port, healthCheckPath, turboPackage, packageManager } =
    options;

  const pm = getPmConfig(packageManager);
  const installPm = pm.install ? `RUN ${pm.install}` : '';
  const hasFetch = packageManager === 'pnpm';

  // pnpm has fetch which allows better caching
  const depsInstall = hasFetch
    ? `# Fetch and install from cache
RUN --mount=type=cache,id=${pm.cacheId},target=${pm.cacheTarget} \\
    ${pm.fetch}

RUN --mount=type=cache,id=${pm.cacheId},target=${pm.cacheTarget} \\
    ${pm.installCmd}`
    : `# Install dependencies with cache
RUN --mount=type=cache,id=${pm.cacheId},target=${pm.cacheTarget} \\
    ${pm.installCmd}`;

  return `# syntax=docker/dockerfile:1
# Stage 1: Prune monorepo
FROM ${baseImage} AS pruner

WORKDIR /app

${installPm}
RUN ${pm.addGlobal} turbo

COPY . .

# Prune to only include necessary packages
RUN turbo prune ${turboPackage} --docker

# Stage 2: Install dependencies
FROM ${baseImage} AS deps

WORKDIR /app

${installPm}

# Copy pruned lockfile and package.jsons
COPY --from=pruner /app/out/${pm.lockfile} ./
COPY --from=pruner /app/out/json/ ./

${depsInstall}

# Stage 3: Build
FROM deps AS builder

WORKDIR /app

# Copy pruned source
COPY --from=pruner /app/out/full/ ./

# Build production server
RUN ${pm.run} gkm build --provider server --production

# Stage 4: Production
FROM ${baseImage} AS runner

WORKDIR /app

RUN apk add --no-cache tini

RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 hono

COPY --from=builder --chown=hono:nodejs /app/.gkm/server/dist/server.mjs ./

ENV NODE_ENV=production
ENV PORT=${port}

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget -q --spider http://localhost:${port}${healthCheckPath} || exit 1

USER hono

EXPOSE ${port}

ENTRYPOINT ["/sbin/tini", "--"]
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

# Install tini for proper signal handling as PID 1
# Handles SIGTERM propagation and zombie process reaping
RUN apk add --no-cache tini

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

# Use tini as entrypoint to handle PID 1 responsibilities
ENTRYPOINT ["/sbin/tini", "--"]
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
