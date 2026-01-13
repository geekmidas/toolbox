# 3. Configuration Loading

## 3.1 Smart Config Loader

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

---

[← Previous: Target Architecture](./2-target-architecture.md) | [Next: Dev Server →](./4-dev-server.md)
