# @geekmidas/cli

Command-line tools for building and deploying API applications.

## Installation

```bash
npm install -g @geekmidas/cli
# or
pnpm add -g @geekmidas/cli
```

## Features

- **Project scaffolding** with interactive prompts
- Build AWS Lambda handlers from endpoint definitions
- Generate OpenAPI specifications
- Create React Query hooks from API definitions
- Multi-provider support (API Gateway v1/v2, Hono server)
- Development server with hot reload and Telescope integration

## Commands

### Init

Scaffold a new project with interactive prompts.

```bash
# Interactive mode
gkm init

# With project name
gkm init my-api

# Non-interactive with defaults
gkm init my-api --yes

# Monorepo setup
gkm init my-project --monorepo --api-path apps/api
```

**Interactive Prompts:**

```
? Project name: › my-api
? Template: › (Use arrow keys)
    Minimal - Basic health endpoint
  ❯ API - Full API with auth, database, services
    Serverless - AWS Lambda handlers
    Worker - Background job processing

? Include Telescope (debugging dashboard)? › Yes
? Include database support (Kysely)? › Yes
? Route organization: ›
  ❯ File-based - Folder structure matches URL paths
    Flat - All endpoints in one folder
? Setup as monorepo? › No
```

**Options:**

| Option | Description |
|--------|-------------|
| `--template <name>` | Project template (minimal, api, serverless, worker) |
| `--skip-install` | Skip dependency installation |
| `-y, --yes` | Skip prompts, use defaults |
| `--monorepo` | Setup as monorepo with pnpm workspaces |
| `--api-path <path>` | API app path for monorepo (default: apps/api) |

**Templates:**

| Template | Description | Key Features |
|----------|-------------|--------------|
| `minimal` | Basic health endpoint | Hono, envkit, logger |
| `api` | Full API with auth, database | + auth, db, cache, services |
| `serverless` | AWS Lambda handlers | + cloud, Lambda adapters |
| `worker` | Background job processing | + events, subscribers, crons |

**Generated Files (Standalone):**

```
my-api/
├── src/
│   ├── config/
│   │   ├── env.ts
│   │   ├── logger.ts
│   │   └── telescope.ts (if enabled)
│   └── endpoints/
│       └── health.ts
├── .env
├── .env.example
├── .env.development
├── .env.test
├── .gitignore
├── biome.json
├── docker-compose.yml
├── gkm.config.ts
├── package.json
├── tsconfig.json
└── turbo.json
```

**Generated Files (Monorepo):**

```
my-project/
├── apps/
│   └── api/
│       ├── src/
│       │   ├── config/
│       │   └── endpoints/
│       ├── .env
│       ├── gkm.config.ts
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── models/
│       ├── src/
│       │   └── index.ts (shared Zod schemas)
│       ├── package.json
│       └── tsconfig.json
├── biome.json
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── turbo.json
```

### Build

Generate Lambda handlers or server applications from endpoint definitions.

```bash
# Build for AWS API Gateway v2
gkm build --provider aws-apigatewayv2 --source "./src/endpoints/**/*.ts"

# Build for AWS API Gateway v1
gkm build --provider aws-apigatewayv1 --source "./src/endpoints/**/*.ts"

# Build server application
gkm build --provider server --port 3000
```

**Options:**

| Option | Description |
|--------|-------------|
| `--provider` | Target provider (aws-apigatewayv1, aws-apigatewayv2, server) |
| `--source` | Glob pattern for endpoint files |
| `--output` | Output directory (default: ./dist) |
| `--port` | Server port (for server provider) |

### OpenAPI

Generate OpenAPI specification from endpoint definitions.

```bash
gkm openapi --source "./src/endpoints/**/*.ts" --output api-docs.json
```

**Options:**

| Option | Description |
|--------|-------------|
| `--source` | Glob pattern for endpoint files |
| `--output` | Output file path |
| `--title` | API title |
| `--version` | API version |
| `--description` | API description |

### Generate React Query

Generate React Query hooks from OpenAPI specification.

```bash
gkm generate:react-query --input api-docs.json --output ./src/api
```

**Options:**

| Option | Description |
|--------|-------------|
| `--input` | Path to OpenAPI spec file |
| `--output` | Output directory for generated hooks |

### Dev Server

Start a development server with hot reload.

```bash
gkm dev --source "./src/endpoints/**/*.ts" --port 3000
```

**Options:**

| Option | Description |
|--------|-------------|
| `--source` | Glob pattern for endpoint files |
| `--port` | Server port (default: 3000) |

## Configuration File

Create a `gkm.config.ts` file in your project root:

```typescript
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  source: './src/endpoints/**/*.ts',
  output: './dist',
  provider: 'aws-apigatewayv2',
  openapi: {
    title: 'My API',
    version: '1.0.0',
    description: 'API for my application',
  },
});
```

Then run commands without options:

```bash
gkm build
gkm openapi
gkm dev
```
