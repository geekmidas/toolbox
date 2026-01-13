# 7. Client Generation

## 7.1 Smart Client Generation

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

---

[← Previous: Secrets](./6-secrets.md) | [Next: Init Command →](./8-init-command.md)
