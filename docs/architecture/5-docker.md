# 5. Docker

## 5.1 Next.js Dockerfile Template

```typescript
// packages/cli/src/docker/nextjs-template.ts

import type { PackageManager } from './templates';

export interface NextjsDockerfileOptions {
  baseImage: string;
  port: number;
  packageManager: PackageManager;
  turbo?: boolean;
  turboPackage?: string;
}

/**
 * Generate a Dockerfile optimized for Next.js with standalone output.
 * Uses Turbo prune for monorepo optimization.
 */
export function generateNextjsDockerfile(
  options: NextjsDockerfileOptions,
): string {
  const { baseImage, port, packageManager, turbo, turboPackage } = options;

  const pm = getPmConfig(packageManager);
  const installPm = pm.install ? `RUN ${pm.install}` : '';
  const turboCmd = packageManager === 'pnpm' ? 'pnpm dlx turbo' : 'npx turbo';

  if (turbo && turboPackage) {
    return generateTurboNextjsDockerfile(options, pm, turboCmd);
  }

  return generateStandaloneNextjsDockerfile(options, pm);
}

function generateTurboNextjsDockerfile(
  options: NextjsDockerfileOptions,
  pm: PmConfig,
  turboCmd: string,
): string {
  const { baseImage, port, turboPackage, packageManager } = options;
  const installPm = pm.install ? `RUN ${pm.install}` : '';
  const turboInstallCmd = getTurboInstallCmd(packageManager);

  return `# syntax=docker/dockerfile:1
# Stage 1: Prune monorepo for Next.js app
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

# Stage 3: Build Next.js
FROM deps AS builder

WORKDIR /app

# Copy pruned source
COPY --from=pruner /app/out/full/ ./

# Set standalone output mode
ENV NEXT_TELEMETRY_DISABLED=1

# Build Next.js with standalone output
RUN ${pm.run} build

# Stage 4: Production
FROM ${baseImage} AS runner

WORKDIR /app

# Install tini for proper signal handling
RUN apk add --no-cache tini

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/apps/${turboPackage}/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/${turboPackage}/.next/static ./apps/${turboPackage}/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/${turboPackage}/public ./apps/${turboPackage}/public

ENV NODE_ENV=production
ENV PORT=${port}
ENV HOSTNAME="0.0.0.0"

USER nextjs

EXPOSE ${port}

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/${turboPackage}/server.js"]
`;
}

function generateStandaloneNextjsDockerfile(
  options: NextjsDockerfileOptions,
  pm: PmConfig,
): string {
  const { baseImage, port } = options;
  const installPm = pm.install ? `RUN ${pm.install}` : '';

  return `# syntax=docker/dockerfile:1
# Stage 1: Install dependencies
FROM ${baseImage} AS deps

WORKDIR /app

${installPm}

COPY package.json ${pm.lockfile} ./

RUN --mount=type=cache,id=${pm.cacheId},target=${pm.cacheTarget} \\
    ${pm.installCmd}

# Stage 2: Build
FROM deps AS builder

WORKDIR /app

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN ${pm.run} build

# Stage 3: Production
FROM ${baseImage} AS runner

WORKDIR /app

RUN apk add --no-cache tini

RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

ENV NODE_ENV=production
ENV PORT=${port}
ENV HOSTNAME="0.0.0.0"

USER nextjs

EXPOSE ${port}

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
`;
}
```

## 5.2 Multi-App Docker Compose

```typescript
// packages/cli/src/docker/compose.ts - EXTEND

import type { NormalizedWorkspace, ServicesConfig } from '../types';

export interface WorkspaceComposeOptions {
  workspace: NormalizedWorkspace;
  services: ServicesConfig;
}

/**
 * Generate docker-compose.yml for entire workspace.
 * Apps can communicate via service names.
 */
export function generateWorkspaceCompose(
  options: WorkspaceComposeOptions,
): string {
  const { workspace, services } = options;

  let yaml = `version: '3.8'

services:
`;

  // Add app services
  for (const [name, app] of Object.entries(workspace.apps)) {
    yaml += generateAppService(name, app, workspace);
  }

  // Add infrastructure services
  yaml += generateInfraServices(services);

  // Add volumes
  yaml += generateVolumes(services);

  // Add networks
  yaml += `
networks:
  app-network:
    driver: bridge
`;

  return yaml;
}

function generateAppService(
  name: string,
  app: AppConfig,
  workspace: NormalizedWorkspace,
): string {
  const isBackend = app.type === 'backend';
  const dockerfilePath = isBackend
    ? `.gkm/docker/${name}/Dockerfile`
    : `.gkm/docker/${name}/Dockerfile.nextjs`;

  let service = `
  ${name}:
    build:
      context: .
      dockerfile: ${dockerfilePath}
    container_name: ${workspace.name}-${name}
    restart: unless-stopped
    ports:
      - "\${${name.toUpperCase()}_PORT:-${app.port}}:${app.port}"
    environment:
      - NODE_ENV=production
`;

  // Add dependency URLs
  if (app.dependencies?.length) {
    for (const dep of app.dependencies) {
      const depApp = workspace.apps[dep];
      if (depApp) {
        const envKey = `${dep.toUpperCase()}_URL`;
        service += `      - ${envKey}=http://${dep}:${depApp.port}
`;
      }
    }
  }

  // Add service URLs
  service += `    networks:
      - app-network
`;

  // Add depends_on for dependencies
  if (app.dependencies?.length) {
    service += `    depends_on:
`;
    for (const dep of app.dependencies) {
      service += `      ${dep}:
        condition: service_healthy
`;
    }
  }

  return service;
}

function generateInfraServices(services: ServicesConfig): string {
  let yaml = '';

  if (services.db) {
    yaml += `
  db:
    image: postgres:18-alpine
    container_name: gkm-db
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

  if (services.cache) {
    yaml += `
  cache:
    image: redis:8-alpine
    container_name: gkm-cache
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

  if (services.mail) {
    yaml += `
  mail:
    image: axllent/mailpit:latest
    container_name: gkm-mail
    restart: unless-stopped
    ports:
      - "8025:8025"   # Web UI
      - "1025:1025"   # SMTP
    networks:
      - app-network
`;
  }

  return yaml;
}

function generateVolumes(services: ServicesConfig): string {
  let yaml = `
volumes:
`;

  if (services.db) {
    yaml += `  postgres_data:
`;
  }

  if (services.cache) {
    yaml += `  redis_data:
`;
  }

  return yaml;
}
```

---

[← Previous: Dev Server](./4-dev-server.md) | [Next: Secrets →](./6-secrets.md)
