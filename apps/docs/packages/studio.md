# @geekmidas/studio

Unified development dashboard combining request monitoring and database browsing capabilities.

## Installation

```bash
pnpm add @geekmidas/studio
```

## Overview

Studio provides a comprehensive development dashboard that combines:
- Request/exception monitoring (via Telescope integration)
- Database schema browsing and data inspection
- Real-time WebSocket updates

## Features

- Wraps @geekmidas/telescope for request/exception monitoring
- Database schema introspection via Kysely
- Cursor-based pagination for efficient data browsing
- Filtering and sorting with multiple operators
- WebSocket real-time updates
- Configurable table exclusions
- Binary column handling options

## Usage

### Basic Setup

```typescript
import { Studio, InMemoryStorage } from '@geekmidas/studio';
import { createMiddleware, createUI } from '@geekmidas/studio/server/hono';
import { Hono } from 'hono';
import type { Database } from './db';

const studio = new Studio<Database>({
  storage: new InMemoryStorage(),
  db: kyselyInstance,
  enabled: process.env.NODE_ENV === 'development',
  excludeTables: ['migrations', 'sessions'],
});

const app = new Hono();

// Add middleware to capture requests
app.use('*', createMiddleware(studio));

// Mount the dashboard
app.route('/__studio', createUI(studio));

// Access dashboard at http://localhost:3000/__studio
```

### With CLI Configuration

```typescript
// gkm.config.ts
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/logger',
  studio: {
    enabled: true,
    path: '/__studio',
  },
});

// Run: gkm dev
// Studio available at http://localhost:3000/__studio
```

## Configuration Options

```typescript
interface StudioOptions<DB> {
  // Storage backend for request/exception data
  storage: TelescopeStorage;

  // Kysely database instance for browsing
  db: Kysely<DB>;

  // Enable/disable Studio
  enabled?: boolean;

  // Tables to exclude from browser
  excludeTables?: string[];

  // Maximum body size to record (bytes)
  maxBodySize?: number;

  // Auto-prune entries older than (hours)
  pruneAfterHours?: number;

  // URL patterns to ignore
  ignorePatterns?: string[];
}
```

## Database Browser

### Schema Introspection

Studio automatically discovers your database schema:
- Table names and structure
- Column names and types
- Primary keys for pagination

### Filtering

Support for multiple filter operators:

| Operator | Description | Example |
|----------|-------------|---------|
| `eq` | Equals | `status eq 'active'` |
| `neq` | Not equals | `status neq 'deleted'` |
| `gt` | Greater than | `age gt 18` |
| `gte` | Greater or equal | `age gte 21` |
| `lt` | Less than | `price lt 100` |
| `lte` | Less or equal | `price lte 50` |
| `contains` | Contains string | `name contains 'john'` |
| `startsWith` | Starts with | `email startsWith 'admin'` |
| `endsWith` | Ends with | `email endsWith '@example.com'` |
| `isNull` | Is null | `deleted_at isNull` |
| `isNotNull` | Is not null | `verified_at isNotNull` |

### Sorting

Click column headers to sort, or use the API:

```
GET /__studio/api/tables/users?sort=created_at&order=desc
```

### Pagination

Cursor-based pagination for efficient large dataset handling:

```
GET /__studio/api/tables/users?cursor=abc123&limit=50
```

## API Endpoints

### Request Monitoring

| Endpoint | Description |
|----------|-------------|
| `GET /api/requests` | List recorded requests |
| `GET /api/requests/:id` | Get request details |
| `GET /api/exceptions` | List recorded exceptions |
| `GET /api/exceptions/:id` | Get exception details |
| `GET /api/logs` | List recorded logs |
| `GET /api/stats` | Get summary statistics |

### Database Browser

| Endpoint | Description |
|----------|-------------|
| `GET /api/schema` | Get database schema |
| `GET /api/tables/:name` | Browse table data |
| `GET /api/tables/:name/:id` | Get single record |

### WebSocket

Connect to `/ws` for real-time updates:

```typescript
const ws = new WebSocket('ws://localhost:3000/__studio/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // { type: 'request' | 'exception' | 'log', payload: ... }
};
```

## Components

### Studio Class

Main orchestrator that combines Telescope and DataBrowser:

```typescript
const studio = new Studio<Database>({
  storage: new InMemoryStorage(),
  db: kyselyInstance,
});

// Record a request manually
studio.recordRequest(requestEntry);

// Record an exception
studio.recordException(exceptionEntry);

// Get database schema
const schema = await studio.getSchema();

// Browse table data
const users = await studio.browseTable('users', {
  limit: 50,
  filters: [{ column: 'status', operator: 'eq', value: 'active' }],
});
```

### DataBrowser

Standalone database browsing component:

```typescript
import { DataBrowser } from '@geekmidas/studio/data';

const browser = new DataBrowser<Database>({
  db: kyselyInstance,
  excludeTables: ['migrations'],
  schemaCacheTtl: 60000, // 1 minute
});

const tables = await browser.getTables();
const columns = await browser.getColumns('users');
const data = await browser.query('users', { limit: 100 });
```

## See Also

- [@geekmidas/telescope](/packages/telescope) - Request recording core
- [@geekmidas/db](/packages/db) - Kysely utilities
- [CLI Reference](/guide/cli-reference) - Development server setup
