# 4. Dev Server

## 4.1 Turbo Orchestration for Dev

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

## 4.2 Dev Services (db, cache, mail)

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

---

[← Previous: Configuration Loading](./3-configuration.md) | [Next: Docker →](./5-docker.md)
