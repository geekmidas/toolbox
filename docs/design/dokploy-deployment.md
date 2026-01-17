# Dokploy Deployment System

**Status**: In Progress
**Impact**: High - Core deployment infrastructure
**Last Updated**: January 2026

## Overview

The Dokploy deployment system enables GKM workspaces to be deployed to self-hosted Dokploy instances with automatic environment variable injection, per-app database isolation, DNS management, and secrets handling.

## Problem Statement

When deploying multi-app workspaces to Dokploy, several challenges arise:

1. **Database Isolation**: All apps receiving the same master `DATABASE_URL` is a security risk
2. **Environment Detection**: Apps need different env vars, but detecting requirements is non-trivial
3. **Entry App Sniffing**: Entry-based apps (vs route-based) require different detection strategies
4. **Secret Generation**: Some secrets (like `BETTER_AUTH_SECRET`) should be auto-generated
5. **DNS Management**: DNS records need to be created and verified
6. **State Persistence**: Credentials and secrets must persist across deploys

## Architecture

### Deploy State

All deployment state is stored at `.gkm/deploy-{stage}.json`:

```typescript
interface DokployStageState {
  provider: 'dokploy';
  stage: string;
  environmentId: string;

  // Dokploy resource IDs
  applications: Record<string, string>;  // appName -> applicationId
  services: {
    postgresId?: string;
    redisId?: string;
  };

  // Per-app database credentials
  appCredentials?: Record<string, {
    dbUser: string;
    dbPassword: string;
  }>;

  // Auto-generated secrets (e.g., BETTER_AUTH_SECRET)
  generatedSecrets?: Record<string, Record<string, string>>;

  // DNS verification status
  dnsVerified?: Record<string, {
    serverIp: string;
    verifiedAt: string;
  }>;

  lastDeployedAt: string;
}
```

### Deployment Flow

```
gkm deploy --provider dokploy --stage production
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. PRE-DEPLOYMENT                                           │
├─────────────────────────────────────────────────────────────┤
│ • Resolve server IP from Dokploy endpoint                   │
│ • Check DNS zone exists                                     │
│ • Create/update DNS A records for all apps                  │
│ • provisionServices() creates Postgres/Redis                │
│ • initializePostgresUsers() creates per-app DB users        │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. SNIFF ALL APPS                                           │
├─────────────────────────────────────────────────────────────┤
│ For each app:                                               │
│ • Entry apps → subprocess with module interception          │
│ • Route apps → sniff envParser                              │
│ Result: Map<appName, requiredEnvVars[]>                     │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. RESOLVE ENV VARS                                         │
├─────────────────────────────────────────────────────────────┤
│ For each app, resolve each sniffed var:                     │
│ • Auto-supported → compute value                            │
│ • User-provided → read from secrets store                   │
│ • Missing → collect for error                               │
│                                                             │
│ If any missing: FAIL deployment                             │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. DEPLOY APPS                                              │
├─────────────────────────────────────────────────────────────┤
│ For each app:                                               │
│ • Build Docker image                                        │
│ • Push to registry                                          │
│ • saveApplicationEnv() with resolved vars                   │
│ • deployApplication()                                       │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. POST-DEPLOYMENT                                          │
├─────────────────────────────────────────────────────────────┤
│ • Verify DNS records (skip if already verified in state)    │
│ • Save state to .gkm/deploy-{stage}.json                    │
└─────────────────────────────────────────────────────────────┘
```

## Per-App Database Isolation

### Schema Assignment

Following the same pattern as local dev mode (`docker/postgres/init.sh`):

| App Name | Database User | Schema | Notes |
|----------|---------------|--------|-------|
| `api` | `api` | `public` | Shared tables, migrations run here |
| `auth` | `auth` | `auth` | `search_path=auth` |
| `admin-auth` | `admin-auth` | `admin_auth` | `search_path=admin_auth` |

### Database User Creation

```sql
-- API user: public schema access
CREATE USER "api" WITH PASSWORD 'xxx';
GRANT ALL ON SCHEMA public TO "api";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "api";

-- Auth user: dedicated schema
CREATE USER "auth" WITH PASSWORD 'yyy';
CREATE SCHEMA IF NOT EXISTS "auth" AUTHORIZATION "auth";
ALTER USER "auth" SET search_path TO "auth";
```

### Connection URL Format

Each app receives its own `DATABASE_URL`:

```
postgresql://{appName}:{password}@{postgresContainer}:5432/{databaseName}
```

Example:
```
DATABASE_URL=postgresql://auth:def456@postgres-myproject:5432/myproject
```

## Environment Variable Detection

### App Types

1. **Route-based apps**: Use `envParser` config, sniffed via `SnifferEnvironmentParser`
2. **Entry-based apps**: Import entry file in subprocess with module interception

### Entry App Sniffing

Entry apps call `config.parse()` at module load time. To capture env var accesses:

1. Spawn subprocess per app (isolation)
2. Register module loader hook to intercept `@geekmidas/envkit`
3. Replace `EnvironmentParser` with `SnifferEnvironmentParser`
4. Import entry file (triggers `config.parse()`)
5. Capture and return accessed env vars via stdout

```
┌─────────────────────────────────────────────────────────────┐
│ Main Process                                                │
├─────────────────────────────────────────────────────────────┤
│ sniffEntryFile('apps/auth/src/index.ts')                    │
│   └─ spawn subprocess ──────────────────────────────────┐   │
└─────────────────────────────────────────────────────────│───┘
                                                          │
┌─────────────────────────────────────────────────────────▼───┐
│ Subprocess (isolated)                                       │
├─────────────────────────────────────────────────────────────┤
│ 1. Register loader hook (intercepts @geekmidas/envkit)      │
│ 2. import('apps/auth/src/index.ts')                         │
│    └─ Entry imports config                                  │
│       └─ config.parse() called                              │
│          └─ Sniffer captures: PORT, DATABASE_URL, etc.      │
│ 3. console.log(JSON.stringify({ envVars: [...] }))          │
└─────────────────────────────────────────────────────────────┘
```

## Auto-Supported Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `PORT` | App config | Application port |
| `NODE_ENV` | Stage | `production` or `development` |
| `DATABASE_URL` | Generated | Per-app credentials + Postgres service |
| `REDIS_URL` | Service | Redis connection URL |
| `BETTER_AUTH_URL` | Hostname | App's public URL |
| `BETTER_AUTH_SECRET` | Generated | Auto-generated, stored in state |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Frontends | Comma-separated frontend URLs |
| `GKM_MASTER_KEY` | Secrets | For runtime secret decryption |

### Resolution Priority

1. Auto-supported variables (computed at deploy time)
2. User-provided secrets (`gkm secrets set <app> VAR=value`)
3. Missing → deployment fails with actionable error

### Failure Example

```
Deployment failed: auth is missing env vars: STRIPE_SECRET_KEY, SENDGRID_API_KEY

Add them with:
  gkm secrets set auth STRIPE_SECRET_KEY=sk_live_xxx
  gkm secrets set auth SENDGRID_API_KEY=SG.xxx
```

## DNS Management

### Pre-Deployment

1. Resolve Dokploy server IP from endpoint hostname
2. Verify DNS zone exists at provider (Hostinger, Cloudflare, etc.)
3. Create/update A records for all app hostnames

### Post-Deployment Verification

```typescript
for (const [appName, hostname] of appHostnames) {
  // Skip if already verified with same IP
  if (state.dnsVerified[hostname]?.serverIp === serverIp) {
    continue;
  }

  // Verify DNS resolves correctly
  const resolved = await resolveHostname(hostname);
  if (resolved === serverIp) {
    state.dnsVerified[hostname] = { serverIp, verifiedAt: now };
  }
}
```

### State-Aware Verification

- First deploy: verify all DNS records
- Subsequent deploys: skip already-verified hostnames (unless IP changed)
- New apps: only verify new hostnames

## Example: Multi-Auth Workspace

### Workspace Structure

```
apps/
├── api/           # Main API (public schema)
├── web/           # Frontend (React)
├── admin/         # Admin frontend (React)
├── auth/          # User authentication
└── admin-auth/    # Admin authentication
```

### Sniffing Results

```typescript
{
  api: ['PORT', 'DATABASE_URL', 'REDIS_URL'],
  auth: ['PORT', 'DATABASE_URL', 'BETTER_AUTH_URL',
         'BETTER_AUTH_SECRET', 'BETTER_AUTH_TRUSTED_ORIGINS'],
  'admin-auth': ['PORT', 'DATABASE_URL', 'BETTER_AUTH_URL',
                 'BETTER_AUTH_SECRET', 'BETTER_AUTH_TRUSTED_ORIGINS'],
}
```

### Resolved Environment Variables

**auth:**
```bash
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://auth:def456@postgres:5432/myproject
BETTER_AUTH_URL=https://auth.staging.example.com
BETTER_AUTH_SECRET=<auto-generated-secret-1>
BETTER_AUTH_TRUSTED_ORIGINS=https://web.staging.example.com
```

**admin-auth:**
```bash
NODE_ENV=production
PORT=3002
DATABASE_URL=postgresql://admin-auth:ghi789@postgres:5432/myproject
BETTER_AUTH_URL=https://admin-auth.staging.example.com
BETTER_AUTH_SECRET=<auto-generated-secret-2>
BETTER_AUTH_TRUSTED_ORIGINS=https://admin.staging.example.com
```

### Final State

```json
{
  "provider": "dokploy",
  "stage": "staging",
  "applications": {
    "api": "app-123",
    "auth": "app-456",
    "admin-auth": "app-789",
    "web": "app-abc",
    "admin": "app-def"
  },
  "services": {
    "postgresId": "pg-xxx",
    "redisId": "redis-yyy"
  },
  "appCredentials": {
    "api": { "dbUser": "api", "dbPassword": "abc123" },
    "auth": { "dbUser": "auth", "dbPassword": "def456" },
    "admin-auth": { "dbUser": "admin-auth", "dbPassword": "ghi789" }
  },
  "generatedSecrets": {
    "auth": { "BETTER_AUTH_SECRET": "secret1..." },
    "admin-auth": { "BETTER_AUTH_SECRET": "secret2..." }
  },
  "dnsVerified": {
    "api.staging.example.com": { "serverIp": "1.2.3.4", "verifiedAt": "..." },
    "auth.staging.example.com": { "serverIp": "1.2.3.4", "verifiedAt": "..." },
    "admin-auth.staging.example.com": { "serverIp": "1.2.3.4", "verifiedAt": "..." },
    "web.staging.example.com": { "serverIp": "1.2.3.4", "verifiedAt": "..." },
    "admin.staging.example.com": { "serverIp": "1.2.3.4", "verifiedAt": "..." }
  },
  "lastDeployedAt": "2026-01-17T12:00:00.000Z"
}
```

## Security Considerations

1. **Database Isolation**: Each app has its own user/schema, preventing cross-app access
2. **External Port Management**: Postgres external port enabled only during user creation, then disabled
3. **Secret Storage**: Credentials stored in gitignored state file (`.gkm/`)
4. **Secret Generation**: Auto-generated secrets use `crypto.randomBytes(32)`
5. **DNS Verification**: Ensures records point to correct server before marking as verified

## Implementation Status

| Feature | Status |
|---------|--------|
| Postgres defaults (18, project name) | Done |
| Redis defaults (8) | Done |
| Per-app database credentials | Done |
| `initializePostgresUsers()` | Done |
| Per-app `DATABASE_URL` injection | Done |
| Entry app sniffing via subprocess | Planned |
| Auto-supported env var resolution | Planned |
| `generatedSecrets` state | Planned |
| DNS verification with state | Planned |
| Better Auth env var handling | Planned |

## Files

| File | Purpose |
|------|---------|
| `packages/cli/src/deploy/index.ts` | Main deployment orchestration |
| `packages/cli/src/deploy/state.ts` | State management |
| `packages/cli/src/deploy/sniffer.ts` | Environment variable detection |
| `packages/cli/src/deploy/dokploy-api.ts` | Dokploy API client |
| `packages/cli/src/deploy/dns/index.ts` | DNS orchestration |

## Related Documentation

- [Environment Variable Detection](./environment-variable-detection.md)
- [GKM CLI Documentation](../../packages/cli/README.md)
