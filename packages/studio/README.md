# @geekmidas/studio

A Supabase-style database browser and development tools dashboard for your applications. Browse tables, filter data, and monitor requests in real-time.

## Features

- **Database Browser** - Browse and query your PostgreSQL tables with a modern UI
- **Filtering** - Filter data with multiple operators (equals, contains, greater than, etc.)
- **Sorting** - Sort by any column in ascending or descending order
- **Pagination** - Cursor-based pagination for efficient data loading
- **Request Monitoring** - Built-in integration with [@geekmidas/telescope](../telescope) for request/log monitoring
- **Real-time Updates** - WebSocket support for live data updates

## Installation

```bash
pnpm add @geekmidas/studio
```

## Usage

### With `gkm dev` (Recommended)

The easiest way to use Studio is with the CLI's dev server. Add studio configuration to your `gkm.config.ts`:

```typescript
// gkm.config.ts
export default {
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/logger',
  studio: {
    enabled: true,
    path: '/__studio',
    schema: 'public',
  },
};
```

Then run the dev server:

```bash
gkm dev
```

Studio will be available at `http://localhost:3000/__studio`

### Standalone Usage

For manual integration with a Hono application:

```typescript
import { Hono } from 'hono';
import { Studio } from '@geekmidas/studio';
import { InMemoryStorage } from '@geekmidas/telescope/storage/memory';
import { createStudioApp } from '@geekmidas/studio/server/hono';
import { db } from './database';

// Create Studio instance
const studio = new Studio({
  monitoring: {
    storage: new InMemoryStorage(),
  },
  data: {
    db: db, // Your Kysely instance
    cursor: { field: 'id', direction: 'desc' },
  },
});

// Mount Studio routes
const app = new Hono();
app.route('/__studio', createStudioApp(studio));
```

## Configuration

### StudioOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable Studio |
| `path` | `string` | `'/__studio'` | URL path for the dashboard |
| `monitoring.storage` | `TelescopeStorage` | required | Storage backend for request monitoring |
| `monitoring.recordBody` | `boolean` | `true` | Record request/response bodies |
| `monitoring.maxBodySize` | `number` | `65536` | Max body size to record (bytes) |
| `monitoring.ignorePatterns` | `string[]` | `[]` | URL patterns to ignore |
| `data.db` | `Kysely<DB>` | required | Kysely database instance |
| `data.cursor` | `CursorConfig` | required | Default cursor configuration |
| `data.tableCursors` | `Record<string, CursorConfig>` | `{}` | Per-table cursor overrides |
| `data.excludeTables` | `string[]` | migration tables | Tables to hide from browser |
| `data.defaultPageSize` | `number` | `50` | Default rows per page (max: 100) |

## API Endpoints

Studio exposes a REST API for programmatic access:

| Endpoint | Description |
|----------|-------------|
| `GET /api/schema` | Get complete database schema |
| `GET /api/tables` | List all tables with basic info |
| `GET /api/tables/:name` | Get detailed table information |
| `GET /api/tables/:name/rows` | Query table data |

### Query Parameters for `/api/tables/:name/rows`

- `pageSize` - Number of rows per page (default: 50, max: 100)
- `cursor` - Pagination cursor for next/previous page
- `filter[column][operator]=value` - Filter conditions
- `sort=column:direction` - Sort configuration

### Filter Operators

| Operator | Description |
|----------|-------------|
| `eq` | Equals |
| `neq` | Not equals |
| `gt` | Greater than |
| `gte` | Greater than or equal |
| `lt` | Less than |
| `lte` | Less than or equal |
| `like` | SQL LIKE (case-sensitive) |
| `ilike` | SQL ILIKE (case-insensitive) |
| `in` | In array (comma-separated) |
| `nin` | Not in array |
| `is_null` | Is NULL |
| `is_not_null` | Is not NULL |

### Example API Requests

```bash
# Get all tables
curl http://localhost:3000/__studio/api/tables

# Get users table info
curl http://localhost:3000/__studio/api/tables/users

# Query with filtering and sorting
curl "http://localhost:3000/__studio/api/tables/users/rows?filter[status][eq]=active&sort=created_at:desc&pageSize=25"
```

## Exports

```typescript
// Core
import { Studio } from '@geekmidas/studio';

// Data browser (for custom implementations)
import { DataBrowser } from '@geekmidas/studio/data';

// Hono adapter
import { createStudioApp } from '@geekmidas/studio/server/hono';

// Types
import {
  Direction,
  FilterOperator,
  type StudioOptions,
  type TableInfo,
  type QueryResult,
} from '@geekmidas/studio';
```

## License

MIT
