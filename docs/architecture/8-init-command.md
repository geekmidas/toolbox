# 8. Init Command

## 8.1 Project Initialization (`gkm init`)

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

## 8.2 Init Templates

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

## 8.3 Scaffold File Templates

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

[← Previous: Client Generation](./7-client-generation.md) | [Next: Integration →](./9-integration.md)
