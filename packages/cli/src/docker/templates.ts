import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
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

export interface FrontendDockerfileOptions {
	imageName: string;
	baseImage: string;
	port: number;
	/** App path relative to workspace root */
	appPath: string;
	/** Package name for turbo prune */
	turboPackage: string;
	/** Detected package manager */
	packageManager: PackageManager;
	/**
	 * Public URL build args to include in the Dockerfile.
	 * These will be declared as ARG and converted to ENV for Next.js build.
	 * Example: ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_AUTH_URL']
	 */
	publicUrlArgs?: string[];
}

export interface MultiStageDockerfileOptions extends DockerTemplateOptions {
	/** Enable turbo prune for monorepo optimization */
	turbo?: boolean;
	/** Package name for turbo prune (defaults to current directory name) */
	turboPackage?: string;
}

const LOCKFILES: [string, PackageManager][] = [
	['pnpm-lock.yaml', 'pnpm'],
	['bun.lockb', 'bun'],
	['yarn.lock', 'yarn'],
	['package-lock.json', 'npm'],
];

/**
 * Detect package manager from lockfiles
 * Walks up the directory tree to find lockfile (for monorepos)
 */
export function detectPackageManager(
	cwd: string = process.cwd(),
): PackageManager {
	let dir = cwd;
	const root = parse(dir).root;

	// Walk up the directory tree
	while (dir !== root) {
		for (const [lockfile, pm] of LOCKFILES) {
			if (existsSync(join(dir, lockfile))) {
				return pm;
			}
		}
		dir = dirname(dir);
	}

	// Check root directory
	for (const [lockfile, pm] of LOCKFILES) {
		if (existsSync(join(root, lockfile))) {
			return pm;
		}
	}

	return 'pnpm'; // default
}

/**
 * Find the lockfile path by walking up the directory tree
 * Returns the full path to the lockfile, or null if not found
 */
export function findLockfilePath(cwd: string = process.cwd()): string | null {
	let dir = cwd;
	const root = parse(dir).root;

	// Walk up the directory tree
	while (dir !== root) {
		for (const [lockfile] of LOCKFILES) {
			const lockfilePath = join(dir, lockfile);
			if (existsSync(lockfilePath)) {
				return lockfilePath;
			}
		}
		dir = dirname(dir);
	}

	// Check root directory
	for (const [lockfile] of LOCKFILES) {
		const lockfilePath = join(root, lockfile);
		if (existsSync(lockfilePath)) {
			return lockfilePath;
		}
	}

	return null;
}

/**
 * Get the lockfile name for a package manager
 */
export function getLockfileName(pm: PackageManager): string {
	const lockfileMap: Record<PackageManager, string> = {
		pnpm: 'pnpm-lock.yaml',
		npm: 'package-lock.json',
		yarn: 'yarn.lock',
		bun: 'bun.lockb',
	};
	return lockfileMap[pm];
}

/**
 * Check if we're in a monorepo (lockfile is in a parent directory)
 */
export function isMonorepo(cwd: string = process.cwd()): boolean {
	const lockfilePath = findLockfilePath(cwd);
	if (!lockfilePath) {
		return false;
	}

	// Check if lockfile is in a parent directory (not in cwd)
	const lockfileDir = dirname(lockfilePath);
	return lockfileDir !== cwd;
}

/**
 * Check if turbo.json exists (walks up directory tree)
 */
export function hasTurboConfig(cwd: string = process.cwd()): boolean {
	let dir = cwd;
	const root = parse(dir).root;

	while (dir !== root) {
		if (existsSync(join(dir, 'turbo.json'))) {
			return true;
		}
		dir = dirname(dir);
	}

	return existsSync(join(root, 'turbo.json'));
}

/**
 * Get install command for turbo builds (without frozen lockfile)
 * Turbo prune creates a subset that may not perfectly match the lockfile
 */
function getTurboInstallCmd(pm: PackageManager): string {
	const commands: Record<PackageManager, string> = {
		pnpm: 'pnpm install',
		npm: 'npm install',
		yarn: 'yarn install',
		bun: 'bun install',
	};
	return commands[pm];
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
			exec: 'pnpm exec',
			dlx: 'pnpm dlx',
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
			exec: 'npx',
			dlx: 'npx',
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
			exec: 'yarn exec',
			dlx: 'yarn dlx',
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
			exec: 'bunx',
			dlx: 'bunx',
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

# Debug: Show node_modules/.bin contents and build production server
RUN echo "=== node_modules/.bin contents ===" && \
    ls -la node_modules/.bin/ 2>/dev/null || echo "node_modules/.bin not found" && \
    echo "=== Checking for gkm ===" && \
    which gkm 2>/dev/null || echo "gkm not in PATH" && \
    ls -la node_modules/.bin/gkm 2>/dev/null || echo "gkm binary not found in node_modules/.bin" && \
    echo "=== Running build ===" && \
    ./node_modules/.bin/gkm build --provider server --production

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
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \\
  CMD wget -qO- http://localhost:${port}${healthCheckPath} > /dev/null 2>&1 || exit 1

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

	// For turbo builds, we can't use --frozen-lockfile because turbo prune
	// creates a subset that may not perfectly match. Use relaxed install.
	const turboInstallCmd = getTurboInstallCmd(packageManager);

	// Use pnpm dlx for pnpm (avoids global bin dir issues in Docker)
	const turboCmd = packageManager === 'pnpm' ? 'pnpm dlx turbo' : 'npx turbo';

	return `# syntax=docker/dockerfile:1
# Stage 1: Prune monorepo
FROM ${baseImage} AS pruner

WORKDIR /app

${installPm}

COPY . .

# Prune to only include necessary packages
RUN ${turboCmd} prune ${turboPackage} --docker

# Stage 2: Install dependencies
FROM ${baseImage} AS deps

WORKDIR /app

${installPm}

# Copy pruned lockfile and package.jsons
COPY --from=pruner /app/out/${pm.lockfile} ./
COPY --from=pruner /app/out/json/ ./

# Install dependencies (no frozen-lockfile since turbo prune creates a subset)
RUN --mount=type=cache,id=${pm.cacheId},target=${pm.cacheTarget} \\
    ${turboInstallCmd}

# Stage 3: Build
FROM deps AS builder

WORKDIR /app

# Copy pruned source
COPY --from=pruner /app/out/full/ ./

# Debug: Show node_modules/.bin contents and build production server
RUN echo "=== node_modules/.bin contents ===" && \
    ls -la node_modules/.bin/ 2>/dev/null || echo "node_modules/.bin not found" && \
    echo "=== Checking for gkm ===" && \
    which gkm 2>/dev/null || echo "gkm not in PATH" && \
    ls -la node_modules/.bin/gkm 2>/dev/null || echo "gkm binary not found in node_modules/.bin" && \
    echo "=== Running build ===" && \
    ./node_modules/.bin/gkm build --provider server --production

# Stage 4: Production
FROM ${baseImage} AS runner

WORKDIR /app

RUN apk add --no-cache tini

RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 hono

COPY --from=builder --chown=hono:nodejs /app/.gkm/server/dist/server.mjs ./

ENV NODE_ENV=production
ENV PORT=${port}

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \\
  CMD wget -qO- http://localhost:${port}${healthCheckPath} > /dev/null 2>&1 || exit 1

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
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \\
  CMD wget -qO- http://localhost:${port}${healthCheckPath} > /dev/null 2>&1 || exit 1

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

/**
 * Generate a Dockerfile for Next.js frontend apps using standalone output.
 * Uses turbo prune for monorepo optimization.
 * @internal Exported for testing
 */
export function generateNextjsDockerfile(
	options: FrontendDockerfileOptions,
): string {
	const {
		baseImage,
		port,
		appPath,
		turboPackage,
		packageManager,
		publicUrlArgs = ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_AUTH_URL'],
	} = options;

	const pm = getPmConfig(packageManager);
	const installPm = pm.install ? `RUN ${pm.install}` : '';

	// For turbo builds, we can't use --frozen-lockfile because turbo prune
	// creates a subset that may not perfectly match. Use relaxed install.
	const turboInstallCmd = getTurboInstallCmd(packageManager);

	// Use pnpm dlx for pnpm (avoids global bin dir issues in Docker)
	const turboCmd = packageManager === 'pnpm' ? 'pnpm dlx turbo' : 'npx turbo';

	// Generate ARG and ENV declarations for public URLs
	const publicUrlArgDeclarations = publicUrlArgs
		.map((arg) => `ARG ${arg}=""`)
		.join('\n');
	const publicUrlEnvDeclarations = publicUrlArgs
		.map((arg) => `ENV ${arg}=$${arg}`)
		.join('\n');

	return `# syntax=docker/dockerfile:1
# Next.js standalone Dockerfile with turbo prune optimization

# Stage 1: Prune monorepo
FROM ${baseImage} AS pruner

WORKDIR /app

${installPm}

COPY . .

# Prune to only include necessary packages
RUN ${turboCmd} prune ${turboPackage} --docker

# Stage 2: Install dependencies
FROM ${baseImage} AS deps

WORKDIR /app

${installPm}

# Copy pruned lockfile and package.jsons
COPY --from=pruner /app/out/${pm.lockfile} ./
COPY --from=pruner /app/out/json/ ./

# Install dependencies
RUN --mount=type=cache,id=${pm.cacheId},target=${pm.cacheTarget} \\
    ${turboInstallCmd}

# Stage 3: Build
FROM deps AS builder

WORKDIR /app

# Build-time args for public API URLs (populated by gkm deploy)
# These get baked into the Next.js build as public environment variables
${publicUrlArgDeclarations}

# Convert ARGs to ENVs for Next.js build
${publicUrlEnvDeclarations}

# Copy pruned source
COPY --from=pruner /app/out/full/ ./

# Copy workspace root configs for turbo builds (turbo prune doesn't include root configs)
# Using wildcard to make it optional for single-app projects
COPY --from=pruner /app/tsconfig.* ./

# Ensure public directory exists (may be empty for scaffolded projects)
RUN mkdir -p ${appPath}/public

# Set Next.js to produce standalone output
ENV NEXT_TELEMETRY_DISABLED=1

# Build the application
RUN ${turboCmd} run build --filter=${turboPackage}

# Stage 4: Production
FROM ${baseImage} AS runner

WORKDIR /app

# Install tini for proper signal handling
RUN apk add --no-cache tini

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 nextjs

# Set environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=${port}
ENV HOSTNAME="0.0.0.0"

# Copy static files and standalone output
COPY --from=builder --chown=nextjs:nodejs /app/${appPath}/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/${appPath}/.next/static ./${appPath}/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/${appPath}/public ./${appPath}/public

USER nextjs

EXPOSE ${port}

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "${appPath}/server.js"]
`;
}

/**
 * Generate a Dockerfile for backend apps in a workspace.
 * Uses turbo prune for monorepo optimization.
 * @internal Exported for testing
 */
export function generateBackendDockerfile(
	options: FrontendDockerfileOptions & { healthCheckPath?: string },
): string {
	const {
		baseImage,
		port,
		appPath,
		turboPackage,
		packageManager,
		healthCheckPath = '/health',
	} = options;

	const pm = getPmConfig(packageManager);
	const installPm = pm.install ? `RUN ${pm.install}` : '';
	const turboInstallCmd = getTurboInstallCmd(packageManager);
	const turboCmd = packageManager === 'pnpm' ? 'pnpm dlx turbo' : 'npx turbo';

	return `# syntax=docker/dockerfile:1
# Backend Dockerfile with turbo prune optimization

# Stage 1: Prune monorepo
FROM ${baseImage} AS pruner

WORKDIR /app

${installPm}

COPY . .

# Prune to only include necessary packages
RUN ${turboCmd} prune ${turboPackage} --docker

# Stage 2: Install dependencies
FROM ${baseImage} AS deps

WORKDIR /app

${installPm}

# Copy pruned lockfile and package.jsons
COPY --from=pruner /app/out/${pm.lockfile} ./
COPY --from=pruner /app/out/json/ ./

# Install dependencies
RUN --mount=type=cache,id=${pm.cacheId},target=${pm.cacheTarget} \\
    ${turboInstallCmd}

# Stage 3: Build
FROM deps AS builder

WORKDIR /app

# Build-time args for encrypted secrets
ARG GKM_ENCRYPTED_CREDENTIALS=""
ARG GKM_CREDENTIALS_IV=""

# Copy pruned source
COPY --from=pruner /app/out/full/ ./

# Copy workspace root configs for turbo builds (turbo prune doesn't include root configs)
# Using wildcard to make it optional for single-app projects
COPY --from=pruner /app/gkm.config.* ./
COPY --from=pruner /app/tsconfig.* ./

# Write encrypted credentials for gkm build to embed
RUN if [ -n "$GKM_ENCRYPTED_CREDENTIALS" ]; then \
      mkdir -p ${appPath}/.gkm && \
      echo "$GKM_ENCRYPTED_CREDENTIALS" > ${appPath}/.gkm/credentials.enc && \
      echo "$GKM_CREDENTIALS_IV" > ${appPath}/.gkm/credentials.iv; \
    fi

# Build production server using gkm
RUN cd ${appPath} && ./node_modules/.bin/gkm build --provider server --production

# Stage 4: Production
FROM ${baseImage} AS runner

WORKDIR /app

RUN apk add --no-cache tini

RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 hono

# Copy bundled server
COPY --from=builder --chown=hono:nodejs /app/${appPath}/.gkm/server/dist/server.mjs ./

ENV NODE_ENV=production
ENV PORT=${port}

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \\
  CMD wget -qO- http://localhost:${port}${healthCheckPath} > /dev/null 2>&1 || exit 1

USER hono

EXPOSE ${port}

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.mjs"]
`;
}

/**
 * Options for entry-based Dockerfile generation.
 */
export interface EntryDockerfileOptions {
	imageName: string;
	baseImage: string;
	port: number;
	/** App path relative to workspace root */
	appPath: string;
	/** Entry file path relative to app path (e.g., './src/index.ts') */
	entry: string;
	/** Package name for turbo prune */
	turboPackage: string;
	/** Detected package manager */
	packageManager: PackageManager;
	/** Health check path (default: '/health') */
	healthCheckPath?: string;
}

/**
 * Generate a Dockerfile for apps with a custom entry point.
 * Uses esbuild to bundle the entry point into dist/index.mjs with all dependencies.
 * This is used for apps that don't use gkm routes (e.g., Better Auth servers).
 * @internal Exported for testing
 */
export function generateEntryDockerfile(options: EntryDockerfileOptions): string {
	const {
		baseImage,
		port,
		appPath,
		entry,
		turboPackage,
		packageManager,
		healthCheckPath = '/health',
	} = options;

	const pm = getPmConfig(packageManager);
	const installPm = pm.install ? `RUN ${pm.install}` : '';
	const turboInstallCmd = getTurboInstallCmd(packageManager);
	const turboCmd = packageManager === 'pnpm' ? 'pnpm dlx turbo' : 'npx turbo';

	return `# syntax=docker/dockerfile:1
# Entry-based Dockerfile with turbo prune + tsdown bundling

# Stage 1: Prune monorepo
FROM ${baseImage} AS pruner

WORKDIR /app

${installPm}

COPY . .

# Prune to only include necessary packages
RUN ${turboCmd} prune ${turboPackage} --docker

# Stage 2: Install dependencies
FROM ${baseImage} AS deps

WORKDIR /app

${installPm}

# Copy pruned lockfile and package.jsons
COPY --from=pruner /app/out/${pm.lockfile} ./
COPY --from=pruner /app/out/json/ ./

# Install dependencies
RUN --mount=type=cache,id=${pm.cacheId},target=${pm.cacheTarget} \\
    ${turboInstallCmd}

# Stage 3: Build with tsdown
FROM deps AS builder

WORKDIR /app

# Build-time args for encrypted secrets
ARG GKM_ENCRYPTED_CREDENTIALS=""
ARG GKM_CREDENTIALS_IV=""

# Copy pruned source
COPY --from=pruner /app/out/full/ ./

# Copy workspace root configs for turbo builds (turbo prune doesn't include root configs)
# Using wildcard to make it optional for single-app projects
COPY --from=pruner /app/tsconfig.* ./

# Write encrypted credentials for tsdown to embed via define
RUN if [ -n "$GKM_ENCRYPTED_CREDENTIALS" ]; then \
      mkdir -p ${appPath}/.gkm && \
      echo "$GKM_ENCRYPTED_CREDENTIALS" > ${appPath}/.gkm/credentials.enc && \
      echo "$GKM_CREDENTIALS_IV" > ${appPath}/.gkm/credentials.iv; \
    fi

# Bundle entry point with esbuild (outputs to dist/index.mjs)
# Creates a fully standalone bundle with all dependencies included
# Use define to embed credentials if present
RUN cd ${appPath} && \
    if [ -f .gkm/credentials.enc ]; then \
      CREDS=$(cat .gkm/credentials.enc) && \
      IV=$(cat .gkm/credentials.iv) && \
      npx esbuild ${entry} --bundle --platform=node --target=node22 --format=esm \
        --outfile=dist/index.mjs --packages=bundle \
        --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' \
        --define:__GKM_ENCRYPTED_CREDENTIALS__="'\\"$CREDS\\"'" \
        --define:__GKM_CREDENTIALS_IV__="'\\"$IV\\"'"; \
    else \
      npx esbuild ${entry} --bundle --platform=node --target=node22 --format=esm \
        --outfile=dist/index.mjs --packages=bundle \
        --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);'; \
    fi

# Stage 4: Production
FROM ${baseImage} AS runner

WORKDIR /app

RUN apk add --no-cache tini

RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 app

# Copy bundled output only (no node_modules needed - fully bundled)
COPY --from=builder --chown=app:nodejs /app/${appPath}/dist/index.mjs ./

ENV NODE_ENV=production
ENV PORT=${port}

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \\
  CMD wget -qO- http://localhost:${port}${healthCheckPath} > /dev/null 2>&1 || exit 1

USER app

EXPOSE ${port}

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.mjs"]
`;
}
