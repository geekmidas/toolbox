# Brownfield Enhancement Architecture

## @geekmidas/cli Workspace-First Full-Stack Framework

**Version:** 1.0
**Status:** Draft
**Last Updated:** 2025-01-13

---

## 1. Executive Summary

This document describes the architecture for enhancing the `@geekmidas/cli` package to support workspace-first, full-stack TypeScript development. The enhancement evolves the existing single-app CLI into a multi-app orchestration framework while maintaining 100% backwards compatibility with existing configurations.

### Key Architectural Decisions

1. **Wrapper Pattern**: `defineWorkspace()` wraps existing `GkmConfig`, single-app configs auto-wrapped
2. **Turbo Orchestration**: Leverage Turbo for multi-app dev, build, and prune operations
3. **Simplified Services**: db (postgres), cache (redis), mail (mailpit dev-only)
4. **Encrypted Secrets**: Committable `.enc.json` files with shared decryption key
5. **Next.js First**: First frontend framework support with standalone output builds

---

## 2. Current State Analysis

### 2.1 Existing CLI Structure

```
packages/cli/src/
├── config.ts           # defineConfig(), loadConfig() - single-app config
├── types.ts            # GkmConfig, DokployProviderConfig, DockerConfig
├── dev/
│   └── index.ts        # Dev server with tsx, chokidar file watching
├── build/
│   └── index.ts        # Lambda/server builds
├── deploy/
│   ├── dokploy.ts      # Dokploy deployment integration
│   └── types.ts        # DeployResult, DokployDeployOptions
├── docker/
│   ├── templates.ts    # Dockerfile generation (multi-stage, turbo, slim)
│   └── compose.ts      # docker-compose.yml generation
├── secrets/
│   ├── index.ts        # Stage-based secrets management
│   ├── generator.ts    # Password generation
│   └── storage.ts      # Secrets file I/O
└── openapi/
    └── index.ts        # OpenAPI spec + React Query hooks generation
```

### 2.2 Existing Capabilities to Preserve

| Capability | File | Status |
|------------|------|--------|
| Single-app dev server | `dev/index.ts` | Keep as-is for single-app |
| Lambda builds | `build/index.ts` | Extend for workspace |
| Server builds | `build/index.ts` | Extend for workspace |
| Dokploy deploy | `deploy/dokploy.ts` | Extend for multi-app |
| Turbo Dockerfile | `docker/templates.ts` | Reuse for backends |
| Docker Compose | `docker/compose.ts` | Extend for multi-app |
| OpenAPI generation | `openapi/index.ts` | Integrate with client gen |
| Secrets management | `secrets/index.ts` | Extend with encryption |

### 2.3 Existing Service Support

From `docker/compose.ts`:
```typescript
export const DEFAULT_SERVICE_VERSIONS: Record<ComposeServiceName, string> = {
  postgres: '18-alpine',
  redis: '8-alpine',
  rabbitmq: '3-management-alpine',
};
```

---

## 3. Target Architecture

### 3.1 Configuration Model

```typescript
// packages/cli/src/types.ts - NEW ADDITIONS

export interface WorkspaceConfig {
  /** Workspace name (defaults to root package.json name) */
  name?: string;

  /** App definitions */
  apps: Record<string, AppConfig>;

  /** Shared packages glob pattern */
  shared?: {
    packages?: string[];
  };

  /** Default deployment target */
  deploy?: DeployConfig;

  /** Dev services (db, cache, mail) */
  services?: ServicesConfig;

  /** Encrypted secrets configuration */
  secrets?: SecretsConfig;
}

export interface AppConfig {
  /** App type */
  type: 'backend' | 'frontend';

  /** Path relative to workspace root */
  path: string;

  /** Dev server port */
  port: number;

  /** Dependencies on other apps */
  dependencies?: string[];

  /** Per-app deploy target override */
  deploy?: DeployTarget;

  // Backend-specific (extends existing GkmConfig)
  routes?: Routes;
  functions?: Routes;
  crons?: Routes;
  subscribers?: Routes;
  envParser?: string;
  logger?: string;
  telescope?: TelescopeConfig | boolean;

  // Frontend-specific
  framework?: 'nextjs';  // Future: 'vite' | 'expo'
  client?: ClientConfig;
}

export interface SharedConfig {
  /** Glob patterns for shared packages */
  packages?: string[];

  /** Models package configuration */
  models?: ModelsConfig;
}

export interface ModelsConfig {
  /** Path to models package (default: packages/models) */
  path?: string;

  /**
   * Schema library to use.
   * Currently only 'zod' is supported.
   * Future: any StandardSchema-compatible library (valibot, arktype, etc.)
   */
  schema?: 'zod';  // Future: 'valibot' | 'arktype' | 'typebox'
}

export interface ServicesConfig {
  /** PostgreSQL database */
  db?: boolean | { version?: string; image?: string };

  /** Redis cache */
  cache?: boolean | { version?: string; image?: string };

  /** Mail service (mailpit for dev, config for prod) */
  mail?: boolean | MailConfig;
}

export interface MailConfig {
  /** Dev: use mailpit, Prod: SMTP config */
  dev?: boolean;  // Default: true (mailpit)
  smtp?: {
    host: string;
    port: number;
    user?: string;
    pass?: string;
  };
}

export interface SecretsConfig {
  /** Enable encrypted secrets */
  enabled?: boolean;

  /** Encryption algorithm (default: aes-256-gcm) */
  algorithm?: string;

  /** Key derivation (default: scrypt) */
  kdf?: 'scrypt' | 'pbkdf2';
}

export type DeployTarget = 'dokploy' | 'vercel' | 'cloudflare';

export interface DeployConfig {
  /** Default target for all apps */
  default: DeployTarget;

  /** Dokploy-specific config */
  dokploy?: DokployWorkspaceConfig;
}

export interface DokployWorkspaceConfig {
  /** Dokploy API endpoint */
  endpoint: string;

  /** Project ID (1 workspace = 1 project) */
  projectId: string;

  /** Registry for images */
  registry?: string;
  registryId?: string;
}
```

### 3.2 Component Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        gkm CLI Entry Point                          │
│                         (packages/cli/bin)                          │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Configuration Loader                              │
│                   (packages/cli/src/config.ts)                       │
│  ┌─────────────┐    ┌──────────────────┐    ┌───────────────────┐  │
│  │defineConfig │───▶│ detectConfigType │───▶│ WorkspaceResolver │  │
│  │defineWorksp │    │ (single vs multi)│    │ (normalize apps)  │  │
│  └─────────────┘    └──────────────────┘    └───────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
        ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
        │   Dev Module  │  │  Build Module │  │ Deploy Module │
        │               │  │               │  │               │
        │ ┌───────────┐ │  │ ┌───────────┐ │  │ ┌───────────┐ │
        │ │TurboOrch. │ │  │ │TurboBuild │ │  │ │ Dokploy   │ │
        │ │(turbo dev)│ │  │ │(turbo run)│ │  │ │ Deployer  │ │
        │ └───────────┘ │  │ └───────────┘ │  │ └───────────┘ │
        │ ┌───────────┐ │  │ ┌───────────┐ │  │ ┌───────────┐ │
        │ │  Service  │ │  │ │ Dockerfile│ │  │ │  Future:  │ │
        │ │  Manager  │ │  │ │ Generator │ │  │ │  Vercel   │ │
        │ └───────────┘ │  │ └───────────┘ │  │ └───────────┘ │
        │ ┌───────────┐ │  │ ┌───────────┐ │  └───────────────┘
        │ │  Client   │ │  │ │  Next.js  │ │
        │ │   Gen     │ │  │ │  Builder  │ │
        │ └───────────┘ │  │ └───────────┘ │
        └───────────────┘  └───────────────┘
```

### 3.3 File Structure Changes

```
packages/cli/src/
├── config.ts                    # EXTEND: add defineWorkspace()
├── types.ts                     # EXTEND: add workspace types
├── workspace/                   # NEW: workspace orchestration
│   ├── index.ts                 # WorkspaceResolver class
│   ├── validator.ts             # Zod schema validation
│   └── normalizer.ts            # Single→workspace normalization
├── init/                        # NEW: Project initialization
│   ├── index.ts                 # Interactive init command
│   ├── templates.ts             # Scaffold file templates
│   └── prompts.ts               # Inquirer prompts
├── dev/
│   ├── index.ts                 # EXTEND: multi-app support
│   ├── turbo.ts                 # NEW: Turbo orchestration
│   ├── services.ts              # NEW: db/cache/mail service manager
│   └── client-watcher.ts        # NEW: Smart client regeneration
├── build/
│   ├── index.ts                 # EXTEND: multi-app builds
│   ├── nextjs.ts                # NEW: Next.js build handler
│   └── orchestrator.ts          # NEW: Dependency-ordered builds
├── deploy/
│   ├── dokploy.ts               # EXTEND: multi-app deployment
│   ├── orchestrator.ts          # NEW: Deployment orchestration
│   └── types.ts                 # EXTEND: workspace deploy types
├── docker/
│   ├── templates.ts             # EXTEND: add Next.js Dockerfile
│   ├── compose.ts               # EXTEND: multi-app compose
│   └── nextjs-template.ts       # NEW: Next.js Dockerfile generator
└── secrets/
    ├── index.ts                 # EXTEND: encrypted secrets
    ├── encryption.ts            # NEW: AES-256-GCM encryption
    └── storage.ts               # EXTEND: .enc.json support
```

---

## 4. Detailed Design

### 4.1 Configuration Loading

```typescript
// packages/cli/src/config.ts

import { z } from 'zod';
import type { GkmConfig, WorkspaceConfig, AppConfig } from './types';

// Existing single-app config
export function defineConfig(config: GkmConfig): GkmConfig {
  return config;
}

// NEW: Workspace config
export function defineWorkspace(config: WorkspaceConfig): WorkspaceConfig {
  return config;
}

// EXTENDED: Smart config loader
export async function loadConfig(cwd: string = process.cwd()): Promise<{
  type: 'single' | 'workspace';
  config: GkmConfig | WorkspaceConfig;
  workspace: NormalizedWorkspace;  // Always normalized
}> {
  const files = ['gkm.config.json', 'gkm.config.ts', 'gkm.config.js'];

  // ... existing file detection logic ...

  const rawConfig = await loadConfigFile(configPath);

  // Detect config type
  if (isWorkspaceConfig(rawConfig)) {
    const validated = validateWorkspaceConfig(rawConfig);
    return {
      type: 'workspace',
      config: validated,
      workspace: normalizeWorkspace(validated),
    };
  }

  // Single-app: wrap as workspace
  return {
    type: 'single',
    config: rawConfig,
    workspace: wrapSingleAppAsWorkspace(rawConfig),
  };
}

function isWorkspaceConfig(config: unknown): config is WorkspaceConfig {
  return typeof config === 'object' && config !== null && 'apps' in config;
}

function wrapSingleAppAsWorkspace(config: GkmConfig): NormalizedWorkspace {
  return {
    name: getPackageName() || 'app',
    apps: {
      api: {
        type: 'backend',
        path: '.',
        port: 3000,
        ...config,
      },
    },
    services: normalizeServices(config.docker?.compose?.services),
    deploy: { default: 'dokploy' },
  };
}
```

### 4.2 Turbo Orchestration for Dev

```typescript
// packages/cli/src/dev/turbo.ts

import { spawn } from 'node:child_process';
import type { NormalizedWorkspace } from '../workspace';

export interface TurboDevOptions {
  workspace: NormalizedWorkspace;
  filter?: string[];  // Specific apps to run
  services?: boolean; // Start services (db, cache, mail)
}

export async function startTurboDev(options: TurboDevOptions): Promise<void> {
  const { workspace, filter, services = true } = options;

  // 1. Start services if enabled
  if (services && hasServices(workspace.services)) {
    await startDevServices(workspace.services);
  }

  // 2. Build turbo command
  const turboArgs = buildTurboDevArgs(workspace, filter);

  // 3. Inject environment variables for dependencies
  const env = buildDependencyEnv(workspace);

  // 4. Spawn turbo process
  const turbo = spawn('pnpm', ['turbo', ...turboArgs], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    cwd: workspace.root,
  });

  // 5. Handle graceful shutdown
  setupGracefulShutdown(turbo, workspace.services);
}

function buildTurboDevArgs(
  workspace: NormalizedWorkspace,
  filter?: string[],
): string[] {
  const args = ['run', 'dev'];

  // Filter to specific apps
  if (filter?.length) {
    for (const app of filter) {
      args.push('--filter', app);
    }
  }

  // Parallel execution
  args.push('--parallel');

  return args;
}

function buildDependencyEnv(workspace: NormalizedWorkspace): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [name, app] of Object.entries(workspace.apps)) {
    // Each app gets URL env var
    const urlKey = `${name.toUpperCase()}_URL`;
    env[urlKey] = `http://localhost:${app.port}`;
  }

  return env;
}
```

### 4.3 Dev Services (db, cache, mail)

```typescript
// packages/cli/src/dev/services.ts

import { spawn, type ChildProcess } from 'node:child_process';
import type { ServicesConfig } from '../types';

const SERVICE_IMAGES = {
  db: 'postgres:18-alpine',
  cache: 'redis:8-alpine',
  mail: 'axllent/mailpit:latest',
} as const;

const SERVICE_PORTS = {
  db: { container: 5432, host: 5432 },
  cache: { container: 6379, host: 6379 },
  mail: { container: 8025, host: 8025, smtp: 1025 },
} as const;

interface RunningServices {
  processes: Map<string, ChildProcess>;
  cleanup: () => Promise<void>;
}

export async function startDevServices(
  config: ServicesConfig,
): Promise<RunningServices> {
  const processes = new Map<string, ChildProcess>();

  // Start PostgreSQL if enabled
  if (config.db) {
    const image = typeof config.db === 'object' && config.db.image
      ? config.db.image
      : SERVICE_IMAGES.db;

    const dbProcess = await startContainer('gkm-db', image, {
      ports: [`${SERVICE_PORTS.db.host}:${SERVICE_PORTS.db.container}`],
      env: {
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: 'postgres',
        POSTGRES_DB: 'app',
      },
    });
    processes.set('db', dbProcess);
  }

  // Start Redis if enabled
  if (config.cache) {
    const image = typeof config.cache === 'object' && config.cache.image
      ? config.cache.image
      : SERVICE_IMAGES.cache;

    const cacheProcess = await startContainer('gkm-cache', image, {
      ports: [`${SERVICE_PORTS.cache.host}:${SERVICE_PORTS.cache.container}`],
    });
    processes.set('cache', cacheProcess);
  }

  // Start Mailpit if enabled (dev only)
  if (config.mail) {
    const mailProcess = await startContainer('gkm-mail', SERVICE_IMAGES.mail, {
      ports: [
        `${SERVICE_PORTS.mail.host}:${SERVICE_PORTS.mail.container}`,  // Web UI
        `${SERVICE_PORTS.mail.smtp}:1025`,  // SMTP
      ],
    });
    processes.set('mail', mailProcess);
  }

  return {
    processes,
    cleanup: async () => {
      for (const [name, proc] of processes) {
        console.log(`Stopping ${name}...`);
        await stopContainer(`gkm-${name}`);
        proc.kill('SIGTERM');
      }
    },
  };
}

async function startContainer(
  name: string,
  image: string,
  options: { ports: string[]; env?: Record<string, string> },
): Promise<ChildProcess> {
  // Remove existing container if any
  await stopContainer(name);

  const args = [
    'run',
    '--rm',
    '--name', name,
    ...options.ports.flatMap(p => ['-p', p]),
    ...Object.entries(options.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    image,
  ];

  return spawn('docker', args, { stdio: 'inherit' });
}

async function stopContainer(name: string): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
    proc.on('close', () => resolve());
  });
}
```

### 4.4 Next.js Dockerfile Template

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

### 4.5 Encrypted Secrets

```typescript
// packages/cli/src/secrets/encryption.ts

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

export interface EncryptedSecrets {
  version: 1;
  algorithm: typeof ALGORITHM;
  salt: string;      // hex
  iv: string;        // hex
  authTag: string;   // hex
  data: string;      // hex (encrypted JSON)
}

/**
 * Encrypt secrets using AES-256-GCM with scrypt key derivation.
 * The encryption key is derived from a passphrase using scrypt.
 */
export async function encryptSecrets(
  secrets: Record<string, unknown>,
  passphrase: string,
): Promise<EncryptedSecrets> {
  // Generate random salt and IV
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  // Derive key using scrypt
  const key = await scryptAsync(passphrase, salt, KEY_LENGTH) as Buffer;

  // Encrypt
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(secrets);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: ALGORITHM,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data: encrypted.toString('hex'),
  };
}

/**
 * Decrypt secrets using AES-256-GCM.
 */
export async function decryptSecrets(
  encrypted: EncryptedSecrets,
  passphrase: string,
): Promise<Record<string, unknown>> {
  const salt = Buffer.from(encrypted.salt, 'hex');
  const iv = Buffer.from(encrypted.iv, 'hex');
  const authTag = Buffer.from(encrypted.authTag, 'hex');
  const data = Buffer.from(encrypted.data, 'hex');

  // Derive key using scrypt
  const key = await scryptAsync(passphrase, salt, KEY_LENGTH) as Buffer;

  // Decrypt
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}
```

```typescript
// packages/cli/src/secrets/storage.ts - EXTEND

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { encryptSecrets, decryptSecrets, type EncryptedSecrets } from './encryption';

const SECRETS_DIR = '.gkm/secrets';

/**
 * Write encrypted secrets that can be committed to git.
 * Only the passphrase needs to be shared separately.
 */
export async function writeEncryptedSecrets(
  stage: string,
  secrets: Record<string, unknown>,
  passphrase: string,
): Promise<void> {
  const encrypted = await encryptSecrets(secrets, passphrase);

  await mkdir(SECRETS_DIR, { recursive: true });
  const filePath = join(SECRETS_DIR, `${stage}.enc.json`);

  await writeFile(filePath, JSON.stringify(encrypted, null, 2));
}

/**
 * Read and decrypt secrets from committed file.
 */
export async function readEncryptedSecrets(
  stage: string,
  passphrase: string,
): Promise<Record<string, unknown> | null> {
  const filePath = join(SECRETS_DIR, `${stage}.enc.json`);

  if (!existsSync(filePath)) {
    return null;
  }

  const content = await readFile(filePath, 'utf-8');
  const encrypted = JSON.parse(content) as EncryptedSecrets;

  return decryptSecrets(encrypted, passphrase);
}

/**
 * Check if encrypted secrets exist for a stage.
 */
export function encryptedSecretsExist(stage: string): boolean {
  return existsSync(join(SECRETS_DIR, `${stage}.enc.json`));
}
```

### 4.6 Smart Client Generation

```typescript
// packages/cli/src/dev/client-watcher.ts

import chokidar from 'chokidar';
import { generateOpenApi, generateReactQueryClient } from '../openapi';
import type { NormalizedWorkspace, AppConfig } from '../types';

interface ClientWatcherOptions {
  workspace: NormalizedWorkspace;
  debounceMs?: number;
}

interface SchemaChangeDetector {
  isSchemaChange: (path: string, content: string) => boolean;
}

/**
 * Watch for schema changes in backend apps and regenerate clients.
 * Only triggers on:
 * - New endpoint files
 * - Schema changes (.params, .query, .body, .output in endpoint files)
 * Does NOT trigger on:
 * - Handler logic changes
 * - Non-endpoint file changes
 */
export function createClientWatcher(options: ClientWatcherOptions) {
  const { workspace, debounceMs = 500 } = options;

  // Find frontends with backend dependencies
  const dependentFrontends = findDependentFrontends(workspace);

  if (dependentFrontends.length === 0) {
    return null; // No client generation needed
  }

  // Create schema change detector
  const detector = createSchemaChangeDetector();

  // Track pending regenerations
  const pendingRegen = new Map<string, NodeJS.Timeout>();

  // Watch backend endpoint directories
  for (const frontend of dependentFrontends) {
    for (const depName of frontend.dependencies) {
      const backend = workspace.apps[depName];
      if (!backend || backend.type !== 'backend') continue;

      const routesGlob = resolveRoutesGlob(backend);

      const watcher = chokidar.watch(routesGlob, {
        persistent: true,
        ignoreInitial: true,
      });

      watcher.on('all', async (event, path) => {
        // Only process add/change events
        if (event !== 'add' && event !== 'change') return;

        // For new files, always regenerate
        if (event === 'add') {
          scheduleRegeneration(pendingRegen, frontend, depName, debounceMs);
          return;
        }

        // For changes, check if it's a schema change
        const content = await readFile(path, 'utf-8');
        if (detector.isSchemaChange(path, content)) {
          scheduleRegeneration(pendingRegen, frontend, depName, debounceMs);
        }
      });
    }
  }
}

function createSchemaChangeDetector(): SchemaChangeDetector {
  // Track file content hashes for schema-relevant parts
  const schemaHashes = new Map<string, string>();

  return {
    isSchemaChange(path: string, content: string) {
      // Extract schema-relevant parts
      const schemaContent = extractSchemaContent(content);
      const hash = createHash(schemaContent);

      const previousHash = schemaHashes.get(path);
      schemaHashes.set(path, hash);

      return previousHash !== hash;
    },
  };
}

/**
 * Extract schema-relevant content from endpoint file.
 * Looks for: .params(), .query(), .body(), .output()
 */
function extractSchemaContent(content: string): string {
  const schemaPatterns = [
    /\.params\s*\([^)]+\)/g,
    /\.query\s*\([^)]+\)/g,
    /\.body\s*\([^)]+\)/g,
    /\.output\s*\([^)]+\)/g,
    /\.path\s*\([^)]+\)/g,
  ];

  const matches: string[] = [];
  for (const pattern of schemaPatterns) {
    const found = content.match(pattern);
    if (found) {
      matches.push(...found);
    }
  }

  return matches.sort().join('\n');
}

function scheduleRegeneration(
  pending: Map<string, NodeJS.Timeout>,
  frontend: AppConfig,
  backendName: string,
  debounceMs: number,
) {
  const key = `${frontend.path}:${backendName}`;

  // Clear existing timeout
  const existing = pending.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  // Schedule new regeneration
  const timeout = setTimeout(async () => {
    pending.delete(key);
    await regenerateClient(frontend, backendName);
  }, debounceMs);

  pending.set(key, timeout);
}

async function regenerateClient(frontend: AppConfig, backendName: string) {
  console.log(`[client-gen] Regenerating client for ${frontend.path} from ${backendName}`);

  // 1. Generate OpenAPI spec from backend
  const openApiSpec = await generateOpenApi({ /* backend config */ });

  // 2. Generate typed client
  await generateReactQueryClient({
    spec: openApiSpec,
    output: frontend.client?.output ?? `${frontend.path}/src/api`,
  });

  console.log(`[client-gen] Done`);
}
```

### 4.7 Multi-App Docker Compose

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

### 4.8 Project Initialization (`gkm init`)

```typescript
// packages/cli/src/init/index.ts

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { input, select, confirm, checkbox } from '@inquirer/prompts';

export interface InitOptions {
  name?: string;
  template?: 'api' | 'fullstack';
  cwd?: string;
}

export interface InitAnswers {
  name: string;
  template: 'api' | 'fullstack';
  services: ('db' | 'cache' | 'mail')[];
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun';
  deploy: 'dokploy' | 'none';
}

/**
 * Interactive project initialization.
 * Creates workspace structure, config file, and scaffolds apps.
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // Gather answers (skip prompts if options provided)
  const answers = await gatherAnswers(options);

  console.log('\nCreating workspace...\n');

  // Create directory structure
  await createDirectoryStructure(cwd, answers);

  // Generate gkm.config.ts
  await generateConfig(cwd, answers);

  // Generate package.json files
  await generatePackageFiles(cwd, answers);

  // Generate app scaffolding
  await scaffoldApps(cwd, answers);

  // Initialize git (optional)
  await initializeGit(cwd);

  // Print success message
  printSuccessMessage(answers);
}

async function gatherAnswers(options: InitOptions): Promise<InitAnswers> {
  const name = options.name ?? await input({
    message: 'Project name:',
    default: 'my-app',
    validate: (v) => /^[a-z0-9-]+$/.test(v) || 'Use lowercase letters, numbers, and hyphens',
  });

  const template = options.template ?? await select({
    message: 'Template:',
    choices: [
      { value: 'api', name: 'API Only - Single backend API' },
      { value: 'fullstack', name: 'Full Stack - API + Next.js + shared models (monorepo)' },
    ],
  });

  const services = await checkbox({
    message: 'Services to include:',
    choices: [
      { value: 'db', name: 'Database (PostgreSQL)', checked: true },
      { value: 'cache', name: 'Cache (Redis)' },
      { value: 'mail', name: 'Mail (Mailpit for dev)' },
    ],
  });

  const packageManager = await select({
    message: 'Package manager:',
    choices: [
      { value: 'pnpm', name: 'pnpm (Recommended)' },
      { value: 'npm', name: 'npm' },
      { value: 'yarn', name: 'yarn' },
      { value: 'bun', name: 'bun' },
    ],
  });

  const deploy = await select({
    message: 'Deployment target:',
    choices: [
      { value: 'dokploy', name: 'Dokploy (Self-hosted)' },
      { value: 'none', name: 'Configure later' },
    ],
  });

  return { name, template, services, packageManager, deploy };
}

async function createDirectoryStructure(
  cwd: string,
  answers: InitAnswers,
): Promise<void> {
  const dirs: string[] = [];

  if (answers.template === 'api') {
    // Single API - flat structure
    dirs.push('src', 'src/endpoints', 'src/config');
  }

  if (answers.template === 'fullstack') {
    // Monorepo structure
    dirs.push(
      'apps/api', 'apps/api/src', 'apps/api/src/endpoints', 'apps/api/src/config',
      'apps/web', 'apps/web/src', 'apps/web/src/app',
      'packages/models', 'packages/models/src',
    );
  }

  for (const dir of dirs) {
    await mkdir(join(cwd, dir), { recursive: true });
  }
}

async function generateConfig(cwd: string, answers: InitAnswers): Promise<void> {
  const configContent = generateConfigContent(answers);
  await writeFile(join(cwd, 'gkm.config.ts'), configContent);
}

function generateConfigContent(answers: InitAnswers): string {
  const { name, template, services, deploy } = answers;

  if (template === 'api') {
    return `import { defineConfig } from '@geekmidas/cli';

export default defineConfig({
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/logger',
  telescope: true,
});
`;
  }

  // fullstack - always monorepo with api + web + packages/models
  const servicesConfig = services.length > 0
    ? `
  services: {
${services.map(s => `    ${s}: true,`).join('\n')}
  },`
    : '';

  const deployConfig = deploy === 'dokploy'
    ? `
  deploy: {
    default: 'dokploy',
    dokploy: {
      endpoint: process.env.DOKPLOY_ENDPOINT || '',
      projectId: process.env.DOKPLOY_PROJECT_ID || '',
    },
  },`
    : '';

  return `import { defineWorkspace } from '@geekmidas/cli';

export default defineWorkspace({
  name: '${name}',

  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env',
      logger: './src/logger',
      telescope: true,
    },

    web: {
      type: 'frontend',
      framework: 'nextjs',
      path: 'apps/web',
      port: 3001,
      dependencies: ['api'],
      client: {
        output: './src/api',
      },
    },
  },
${servicesConfig}
  shared: {
    packages: ['packages/*'],
  },
${deployConfig}
});
`;
}

function printSuccessMessage(answers: InitAnswers): void {
  const pm = answers.packageManager;
  const runCmd = pm === 'npm' ? 'npm run' : pm;

  console.log(`
✓ Workspace "${answers.name}" created successfully!

Next steps:

  1. Install dependencies:
     ${pm} install

  2. Start development:
     ${runCmd} dev

  3. Initialize secrets (optional):
     gkm secrets:init --stage dev

Documentation: https://geekmidas.dev/docs
`);
}
```

### 4.9 Init Templates

```
templates/
├── api/                           # Single backend API
│   ├── src/
│   │   ├── endpoints/
│   │   │   └── health.ts          # Health check endpoint
│   │   ├── config/
│   │   │   └── env.ts             # Environment parser
│   │   └── logger.ts              # Logger setup
│   ├── gkm.config.ts
│   ├── package.json
│   └── tsconfig.json
│
└── fullstack/                     # Monorepo: API + Web + Models
    ├── apps/
    │   ├── api/
    │   │   ├── src/
    │   │   │   ├── endpoints/
    │   │   │   │   └── health.ts
    │   │   │   └── config/
    │   │   │       └── env.ts
    │   │   ├── package.json
    │   │   └── tsconfig.json
    │   └── web/
    │       ├── src/
    │       │   └── app/
    │       │       └── page.tsx
    │       ├── next.config.ts
    │       ├── package.json
    │       └── tsconfig.json
    ├── packages/
    │   └── models/                # Shared Zod schemas
    │       ├── src/
    │       │   ├── index.ts       # Re-exports all models
    │       │   └── user.ts        # Example: User schema
    │       ├── package.json
    │       └── tsconfig.json
    ├── gkm.config.ts
    ├── package.json
    ├── pnpm-workspace.yaml
    └── turbo.json
```

### 4.10 Scaffold File Templates

```typescript
// packages/cli/src/init/templates.ts

export const templates = {
  // Health check endpoint
  healthEndpoint: `import { e } from '@geekmidas/constructs/endpoints';

export default e
  .get('/health')
  .handle(async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));
`,

  // Environment parser
  envParser: `import { EnvironmentParser } from '@geekmidas/envkit';

const env = new EnvironmentParser(process.env);

export const config = env.create((get) => ({
  port: get('PORT').string().transform(Number).default(3000),
  nodeEnv: get('NODE_ENV').string().default('development'),
  database: {
    url: get('DATABASE_URL').string().optional(),
  },
})).parse();

export default env;
`,

  // Logger
  logger: `import { ConsoleLogger } from '@geekmidas/logger/console';

export const logger = new ConsoleLogger({
  app: process.env.APP_NAME || 'api',
});

export default logger;
`,

  // Next.js page
  nextPage: `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Welcome</h1>
      <p className="mt-4 text-gray-600">
        Edit <code>src/app/page.tsx</code> to get started.
      </p>
    </main>
  );
}
`,

  // Next.js config with standalone output
  nextConfig: `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
};

export default nextConfig;
`,

  // Turbo config
  turboJson: `{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^typecheck"]
    }
  }
}
`,

  // Root package.json for workspace
  rootPackageJson: (name: string, pm: string) => `{
  "name": "${name}",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "@geekmidas/cli": "latest",
    "turbo": "^2",
    "typescript": "^5.8"
  }${pm === 'pnpm' ? `,
  "packageManager": "pnpm@10.13.1"` : ''}
}
`,

  // Shared models package - Zod schemas (StandardSchema compatible)
  modelsIndex: `// Re-export all models
// Currently uses Zod, but designed for any StandardSchema-compatible library
export * from './user';
`,

  modelsUser: `import { z } from 'zod';

/**
 * User schema - shared between API and frontend.
 * Used for endpoint validation and typed API clients.
 */
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type User = z.infer<typeof UserSchema>;

export const CreateUserSchema = UserSchema.pick({
  email: true,
  name: true,
});

export type CreateUser = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = UserSchema.pick({
  name: true,
}).partial();

export type UpdateUser = z.infer<typeof UpdateUserSchema>;
`,

  modelsPackageJson: (name: string) => `{
  "name": "@${name}/models",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./*": {
      "types": "./dist/*.d.ts",
      "import": "./dist/*.js"
    }
  },
  "scripts": {
    "build": "tsdown src/index.ts --format esm --dts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.24"
  },
  "devDependencies": {
    "tsdown": "^0.9",
    "typescript": "^5.8"
  }
}
`,
};
```

---

## 5. Integration with Existing Code

### 5.1 Backwards Compatibility

```typescript
// All existing exports remain unchanged
export { defineConfig } from './config';
export type { GkmConfig } from './types';

// New exports are additive
export { defineWorkspace } from './config';
export type { WorkspaceConfig, AppConfig, ServicesConfig } from './types';

// Internal normalization ensures consistency
// Single-app configs are wrapped as workspaces internally
// but external API remains unchanged
```

### 5.2 Command Behavior

| Command | Single-App | Workspace |
|---------|------------|-----------|
| `gkm init` | Scaffold single API | Scaffold workspace with apps |
| `gkm dev` | Start tsx dev server | `turbo run dev --parallel` |
| `gkm build` | Build lambda/server | Build all apps (dependency order) |
| `gkm deploy` | Deploy to Dokploy | Deploy all apps to Dokploy |
| `gkm docker` | Generate Dockerfile | Generate per-app Dockerfiles |
| `gkm compose` | Generate compose.yml | Generate workspace compose.yml |
| `gkm openapi` | Generate OpenAPI spec | Generate per-backend specs |

### 5.3 Environment Variable Injection

```
Development (gkm dev):
┌─────────────────────────────────────────────────────────┐
│ API_URL=http://localhost:3000                           │
│ WEB_URL=http://localhost:3001                           │
│ DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app │
│ REDIS_URL=redis://localhost:6379                        │
│ SMTP_HOST=localhost                                     │
│ SMTP_PORT=1025                                          │
└─────────────────────────────────────────────────────────┘

Production (Docker Compose):
┌─────────────────────────────────────────────────────────┐
│ API_URL=http://api:3000                                 │
│ WEB_URL=http://web:3001                                 │
│ DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/app │
│ REDIS_URL=redis://cache:6379                            │
└─────────────────────────────────────────────────────────┘
```

---

## 6. Configuration Example

```typescript
// gkm.config.ts
import { defineWorkspace } from '@geekmidas/cli';

export default defineWorkspace({
  name: 'my-saas',

  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env',
      logger: './src/logger',
      telescope: true,
    },

    web: {
      type: 'frontend',
      framework: 'nextjs',
      path: 'apps/web',
      port: 3001,
      dependencies: ['api'],
      client: {
        output: './src/api',
      },
    },
  },

  services: {
    db: true,      // postgres:18-alpine
    cache: true,   // redis:8-alpine
    mail: true,    // mailpit (dev), needs SMTP config for prod
  },

  shared: {
    packages: ['packages/*'],
    models: {
      path: 'packages/models',
      schema: 'zod',  // Currently only zod, future: any StandardSchema lib
    },
  },

  secrets: {
    enabled: true, // Use .enc.json files
  },

  deploy: {
    default: 'dokploy',
    dokploy: {
      endpoint: 'https://dokploy.example.com/api',
      projectId: 'my-saas-project',
    },
  },
});
```

---

## 7. CLI Command Reference

```bash
# Initialization
gkm init                   # Interactive workspace setup
gkm init --name my-app     # Initialize with name
gkm init --template api    # Single API (no monorepo)
gkm init --template fullstack  # API + Web + models (monorepo)

# Development
gkm dev                    # Start all apps + services
gkm dev --filter api       # Start only api app
gkm dev --no-services      # Start apps without db/cache/mail

# Building
gkm build                  # Build all apps
gkm build api              # Build specific app
gkm build --provider aws   # Build for AWS Lambda

# Docker
gkm docker                 # Generate Dockerfiles for all apps
gkm compose                # Generate docker-compose.yml

# Deployment
gkm deploy                 # Deploy all apps
gkm deploy api web         # Deploy specific apps
gkm deploy --dry-run       # Preview deployment

# Secrets
gkm secrets:init --stage dev       # Initialize secrets
gkm secrets:encrypt --stage dev    # Encrypt for committing
gkm secrets:decrypt --stage dev    # Decrypt for use

# OpenAPI & Clients
gkm openapi                # Generate OpenAPI specs
gkm client                 # Generate typed clients
```

---

## 8. Migration Path

### 8.1 From Single-App to Workspace

```typescript
// Before: gkm.config.ts
import { defineConfig } from '@geekmidas/cli';

export default defineConfig({
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/logger',
});

// After: gkm.config.ts (backwards compatible!)
// Option 1: Keep as-is (still works!)
// Option 2: Migrate to workspace:
import { defineWorkspace } from '@geekmidas/cli';

export default defineWorkspace({
  apps: {
    api: {
      type: 'backend',
      path: '.',  // Current directory
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env',
      logger: './src/logger',
    },
  },
});
```

### 8.2 Adding Frontend

```typescript
// Step 1: Add Next.js app to workspace
apps: {
  api: { /* existing */ },
  web: {
    type: 'frontend',
    framework: 'nextjs',
    path: 'apps/web',
    port: 3001,
    dependencies: ['api'],
  },
},

// Step 2: Configure next.config.ts
// apps/web/next.config.ts
export default {
  output: 'standalone',  // Required for Docker
};

// Step 3: Run dev
// gkm dev (starts both api and web)
```

---

## 9. Testing Strategy

### 9.1 Unit Tests

- Configuration parsing and validation
- Workspace normalization
- Service URL generation
- Dockerfile template generation
- Secrets encryption/decryption

### 9.2 Integration Tests

- Multi-app dev server startup
- Client generation on schema changes
- Docker build and run
- Compose service orchestration

### 9.3 E2E Tests

- Full workspace: api + web + services
- Deploy to test Dokploy instance
- Verify inter-app communication

---

## 10. Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Turbo compatibility | High | Fall back to manual orchestration if turbo unavailable |
| Breaking existing configs | Critical | Wrapper pattern ensures 100% backwards compatibility |
| Docker build failures | Medium | Extensive template testing, clear error messages |
| Secret key management | High | Document secure key sharing practices |
| Performance regression | Medium | Benchmark single-app vs workspace modes |

---

## 11. Success Metrics

1. **Zero Breaking Changes**: All existing `gkm.config.ts` files work unchanged
2. **Dev Startup < 5s**: 2-app workspace starts in under 5 seconds
3. **Build Parallelization**: Independent apps build in parallel
4. **Client Gen < 2s**: Smart client regeneration completes in under 2 seconds
5. **Docker Image Size**: Backend < 100MB, Frontend < 150MB

---

## 12. Appendices

### A. Service Mapping

| Alias | Service | Default Image | Port |
|-------|---------|---------------|------|
| `db` | PostgreSQL | `postgres:18-alpine` | 5432 |
| `cache` | Redis | `redis:8-alpine` | 6379 |
| `mail` | Mailpit | `axllent/mailpit` | 8025 (UI), 1025 (SMTP) |

### B. Environment Variables

| Variable | Source | Dev Value | Prod Value |
|----------|--------|-----------|------------|
| `{APP}_URL` | Dependencies | `http://localhost:{port}` | `http://{app}:{port}` |
| `DATABASE_URL` | Services | `postgresql://...@localhost:5432` | `postgresql://...@db:5432` |
| `REDIS_URL` | Services | `redis://localhost:6379` | `redis://cache:6379` |
| `SMTP_HOST` | Services | `localhost` | (configured) |
| `SMTP_PORT` | Services | `1025` | (configured) |

### C. Related Documents

- PRD: `docs/prd/`
- Project Brief: `docs/brief.md`
- Technical Reference: `CLAUDE.md`
