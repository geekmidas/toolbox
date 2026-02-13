# @geekmidas/audit

Type-safe audit logging with database integration for tracking application events and user actions.

## Installation

```bash
pnpm add @geekmidas/audit
```

## Features

- Type-safe audit actions with compile-time validation
- Transactional support for atomic database writes
- Pluggable storage backends (Kysely implementation included)
- Actor tracking (users, services, systems)
- Rich metadata support (request context, entity references)
- Query and filtering capabilities

## Package Exports

- `/` - Core types, Auditor interface, and DefaultAuditor
- `/kysely` - KyselyAuditStorage and withAuditableTransaction
- `/memory` - InMemoryAuditStorage for development and testing
- `/cache` - CacheAuditStorage using @geekmidas/cache backends

## Basic Usage

### Define Audit Actions

```typescript
import type { AuditableAction } from '@geekmidas/audit';

// Define type-safe audit actions
type AppAuditAction =
  | AuditableAction<'user.created', { userId: string; email: string }>
  | AuditableAction<'user.updated', { userId: string; changes: string[] }>
  | AuditableAction<'order.placed', { orderId: string; total: number }>;
```

### Set Up Storage

```typescript
import { KyselyAuditStorage } from '@geekmidas/audit/kysely';

const storage = new KyselyAuditStorage<Database>({
  db: kyselyDb,
  tableName: 'audit_logs',
});
```

### Create and Use Auditor

```typescript
import { DefaultAuditor } from '@geekmidas/audit';

const auditor = new DefaultAuditor<AppAuditAction>({
  actor: { id: 'user-123', type: 'user' },
  storage,
  metadata: {
    requestId: 'req-456',
    endpoint: '/api/users',
  },
});

// Type-safe audit recording
auditor.audit('user.created', {
  userId: '789',
  email: 'test@example.com',
});

// Flush to storage
await auditor.flush();
```

## Transactional Audits

Use `withAuditableTransaction` to ensure audits are atomic with database operations:

```typescript
import { withAuditableTransaction } from '@geekmidas/audit/kysely';

const result = await withAuditableTransaction(
  db,
  auditor,
  async (trx) => {
    const user = await trx
      .insertInto('users')
      .values({ name: 'John', email: 'john@example.com' })
      .returningAll()
      .executeTakeFirstOrThrow();

    auditor.audit('user.created', {
      userId: user.id,
      email: user.email,
    });

    return user;
  },
);
```

## Querying Audit Records

The `query()` and `count()` methods on audit storage let you search, filter, and paginate audit records. Both `KyselyAuditStorage` and `CacheAuditStorage` implement these methods.

### Basic Query

```typescript
const records = await storage.query({
  limit: 20,
  offset: 0,
  orderBy: 'timestamp',
  orderDirection: 'desc',
});
```

### Filtering

Filter by any combination of type, actor, entity, table, and date range:

```typescript
// By audit type (single or multiple)
const userEvents = await storage.query({
  type: 'user.created',
});

const allUserEvents = await storage.query({
  type: ['user.created', 'user.updated', 'user.deleted'],
});

// By actor
const actorEvents = await storage.query({
  actorId: 'user-123',
});

// By entity and table
const entityHistory = await storage.query({
  entityId: 'order-456',
  table: 'orders',
});

// By date range
const recentEvents = await storage.query({
  from: new Date('2025-01-01'),
  to: new Date('2025-01-31'),
});
```

### Pagination with Count

Use `count()` alongside `query()` for paginated views:

```typescript
const filter = { type: 'user.created', actorId: 'user-123' };

const total = await storage.count(filter);
const records = await storage.query({
  ...filter,
  limit: 20,
  offset: 0,
});

// { total, records, page: 1, pageSize: 20 }
```

### Query Options Reference

| Option | Type | Description |
|--------|------|-------------|
| `type` | `string \| string[]` | Filter by audit action type |
| `entityId` | `string` | Filter by entity identifier |
| `table` | `string` | Filter by table name |
| `actorId` | `string` | Filter by actor ID |
| `from` | `Date` | Start of date range (inclusive) |
| `to` | `Date` | End of date range (inclusive) |
| `limit` | `number` | Maximum number of results |
| `offset` | `number` | Number of results to skip |
| `orderBy` | `'timestamp' \| 'type'` | Sort field (default: `'timestamp'`) |
| `orderDirection` | `'asc' \| 'desc'` | Sort direction (default: `'desc'`) |

## Integration with @geekmidas/constructs

The audit system integrates deeply with [`@geekmidas/constructs`](/packages/constructs) endpoints. See the [Audit Logging section](/packages/constructs#audit-logging) in the constructs docs for the full guide.

### Quick Setup

Attach an audit storage service to an endpoint or factory with `.auditor()`, identify the actor with `.actor()`, and define audits with `.audit()`:

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

const endpoint = e
  .post('/users')
  .auditor(auditStorageService)
  .actor(({ session }) => ({
    id: session.sub,
    type: 'user',
  }))
  .body(z.object({ name: z.string(), email: z.string() }))
  .output(z.object({ id: z.string(), email: z.string() }))
  .audit([
    {
      type: 'user.created',
      payload: (response) => ({
        userId: response.id,
        email: response.email,
      }),
      entityId: (response) => response.id,
      table: 'users',
    },
  ])
  .handle(async ({ body }) => {
    return await createUser(body);
  });
```

### Factory-Level Defaults

Set `.auditor()` and `.actor()` on an `EndpointFactory` so all endpoints inherit the configuration:

```typescript
import { EndpointFactory } from '@geekmidas/constructs/endpoints';

const api = new EndpointFactory()
  .services([databaseService, auditStorageService])
  .auditor(auditStorageService)
  .actor(({ session }) => ({ id: session.sub, type: 'user' }));

// All endpoints created from this factory inherit auditor and actor
const createUser = api
  .post('/users')
  .audit([{
    type: 'user.created',
    payload: (response) => ({ userId: response.id, email: response.email }),
  }])
  .handle(async ({ body }) => createUser(body));
```

### Manual Auditing in Handlers

When `.auditor()` is configured, the handler context includes an `auditor` instance for manual audit calls:

```typescript
const endpoint = e
  .post('/transfers')
  .auditor(auditStorageService)
  .actor(({ session }) => ({ id: session.sub, type: 'user' }))
  .handle(async ({ body, auditor }) => {
    const result = await processTransfer(body);

    // Type-safe — only valid audit types and payloads are accepted
    auditor.audit('transfer.completed', {
      transferId: result.id,
      amount: result.amount,
    });

    return result;
  });
```

### Transaction Coordination

When the audit storage uses the same database as the endpoint (via `KyselyAuditStorage`), the framework automatically wraps the handler and audit flush in a single database transaction. Both data changes and audit records commit or roll back together:

```typescript
import { KyselyAuditStorage } from '@geekmidas/audit/kysely';

const auditStorageService = {
  serviceName: 'auditStorage' as const,
  async register() {
    return new KyselyAuditStorage<Database>({
      db: kyselyDb,
      tableName: 'audit_logs',
      databaseServiceName: 'database', // matches the endpoint's database service
    });
  },
} satisfies Service<'auditStorage', KyselyAuditStorage<Database>>;

const api = new EndpointFactory()
  .services([databaseService, auditStorageService])
  .database(databaseService)
  .auditor(auditStorageService)
  .actor(({ session }) => ({ id: session.sub, type: 'user' }));

// Handler, declarative audits, and manual audits all share one transaction
const endpoint = api
  .post('/users')
  .audit([{
    type: 'user.created',
    payload: (response) => ({ userId: response.id, email: response.email }),
  }])
  .handle(async ({ body, db }) => {
    return await db
      .insertInto('users')
      .values(body)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
```

## Database Schema

```sql
CREATE TABLE audit_logs (
  id VARCHAR(21) PRIMARY KEY,
  type VARCHAR(255) NOT NULL,
  operation VARCHAR(20) NOT NULL,
  "table" VARCHAR(255),
  "entityId" VARCHAR(255),
  "oldValues" JSONB,
  "newValues" JSONB,
  payload JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actorId" VARCHAR(255),
  "actorType" VARCHAR(50),
  "actorData" JSONB,
  metadata JSONB
);
```
