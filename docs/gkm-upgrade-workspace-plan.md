# Plan: gkm upgrade with Workspace Support

## Goal
Update `gkm upgrade` to find all @geekmidas/* packages across workspace apps, update their versions directly, then run install. Only update packages that match the app type (backend/frontend).

## Package Types by App

**Backend packages (type: 'backend'):**
- dependencies: audit, constructs, envkit, events, logger, rate-limit, schema, services, errors, auth
- devDependencies: cli

**Frontend packages (type: 'frontend'):**
- dependencies: client, envkit
- devDependencies: cli

## Approach
1. Load gkm config via `loadWorkspaceConfig()`
2. For each app, get its type (backend/frontend)
3. Scan app's package.json for @geekmidas/* packages that match its type
4. Update only matching package versions to latest
5. Run `pnpm install` (or equivalent)

## Implementation

### File: `/packages/cli/src/upgrade/index.ts`

#### 1. Define allowed packages per app type
```typescript
const BACKEND_PACKAGES = [
  '@geekmidas/audit', '@geekmidas/constructs', '@geekmidas/envkit',
  '@geekmidas/events', '@geekmidas/logger', '@geekmidas/rate-limit',
  '@geekmidas/schema', '@geekmidas/services', '@geekmidas/errors',
  '@geekmidas/auth', '@geekmidas/cli'
];

const FRONTEND_PACKAGES = [
  '@geekmidas/client', '@geekmidas/envkit', '@geekmidas/cli'
];
```

#### 2. Load workspace and get app info
```typescript
async function getWorkspaceApps(cwd: string): Promise<AppInfo[]> {
  const apps: AppInfo[] = [{ path: cwd, type: 'root' }]; // Root always included

  try {
    const config = await loadWorkspaceConfig(cwd);
    if (config?.apps) {
      for (const [name, app] of Object.entries(config.apps)) {
        apps.push({
          name,
          path: join(cwd, app.path),
          type: app.type || 'backend', // default to backend
        });
      }
    }
  } catch {
    // No gkm config, just use root
  }

  return apps;
}
```

#### 3. Collect packages with type filtering
```typescript
function collectPackagesForApp(app: AppInfo): PackageInfo[] {
  const pkgPath = join(app.path, 'package.json');
  if (!existsSync(pkgPath)) return [];

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const allowedPackages = app.type === 'frontend' ? FRONTEND_PACKAGES
                        : app.type === 'backend' ? BACKEND_PACKAGES
                        : [...BACKEND_PACKAGES, ...FRONTEND_PACKAGES]; // root: all

  const results: PackageInfo[] = [];
  for (const dep of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(pkg[dep] || {})) {
      if (name.startsWith('@geekmidas/') && allowedPackages.includes(name)) {
        results.push({ app, name, version, depType: dep });
      }
    }
  }
  return results;
}
```

#### 4. Update package.json files
```typescript
function updatePackageVersions(
  packageJsonPath: string,
  updates: { name: string; newVersion: string; depType: string }[]
): void {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  for (const { name, newVersion, depType } of updates) {
    if (pkg[depType]?.[name]) {
      // Preserve version prefix (^, ~)
      const prefix = pkg[depType][name].match(/^[\^~]/)?.[0] || '~';
      pkg[depType][name] = prefix + newVersion;
    }
  }
  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}
```

#### 5. Main flow
```typescript
export async function upgradeCommand(options: UpgradeOptions = {}) {
  const cwd = process.cwd();
  const pm = detectPackageManager(cwd);

  // 1. Load workspace apps
  const apps = await getWorkspaceApps(cwd);

  // 2. Collect packages per app (filtered by type)
  const allPackages = apps.flatMap(collectPackagesForApp);

  // 3. If not --all, filter to just cli
  const packages = options.all ? allPackages
    : allPackages.filter(p => p.name === '@geekmidas/cli');

  // 4. Check latest versions from npm (dedupe by package name)
  const latestVersions = await getLatestVersions([...new Set(packages.map(p => p.name))]);

  // 5. Find packages that need updates
  const needsUpdate = packages.filter(p =>
    latestVersions[p.name] && stripPrefix(p.version) !== latestVersions[p.name]
  );

  // 6. Display and apply updates
  displayUpdates(needsUpdate, latestVersions);
  if (options.dryRun) return;

  applyUpdates(needsUpdate, latestVersions);

  // 7. Run install
  spawnSync(pm, ['install'], { cwd, stdio: 'inherit' });
}
```

### Dependencies
- No new dependencies needed
- Uses existing `loadWorkspaceConfig()` from config.ts

### Output Format
```
📦 GeekMidas CLI Upgrade

Package manager: pnpm
Apps: root, api (backend), web (frontend)

Checking for updates...

Packages to update:

  @geekmidas/cli: 1.2.1 → 1.2.2
    - package.json (devDependencies)
    - apps/api/package.json (devDependencies)
    - apps/web/package.json (devDependencies)

  @geekmidas/constructs: 1.0.0 → 1.1.0
    - apps/api/package.json (dependencies)

  @geekmidas/client: 1.0.0 → 1.1.0
    - apps/web/package.json (dependencies)

Running: pnpm install

✅ Upgrade complete!
```

## Files to Modify
- `/packages/cli/src/upgrade/index.ts` - Main implementation

## Edge Cases
- No gkm config → use root only with all packages allowed
- Package appears in wrong app type → skip (don't upgrade @geekmidas/constructs in frontend)
- Version prefixes (^, ~) → preserve them
- Package in both deps and devDeps → update both
