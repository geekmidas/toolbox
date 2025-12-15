# @geekmidas/cli

Command-line tools for building and deploying API applications.

## Installation

```bash
npm install -g @geekmidas/cli
# or
pnpm add -g @geekmidas/cli
```

## Features

- Build AWS Lambda handlers from endpoint definitions
- Generate OpenAPI specifications
- Create React Query hooks from API definitions
- Multi-provider support (API Gateway v1/v2, Hono server)
- Development server with hot reload

## Commands

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
import { defineConfig } from '@geekmidas/cli';

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
