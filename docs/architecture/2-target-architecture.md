# 2. Target Architecture

## 2.1 Configuration Model

```typescript
// packages/cli/src/types.ts - NEW ADDITIONS

export interface WorkspaceConfig {
  /** Workspace name (defaults to root package.json name) */
  name?: string;

  /** App definitions */
  apps: Record<string, AppConfig>;

  /** Shared packages glob pattern */
  shared?: SharedConfig;

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

## 2.2 Component Architecture

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

## 2.3 File Structure Changes

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

[← Previous: Current State](./1-current-state.md) | [Next: Configuration Loading →](./3-configuration.md)
