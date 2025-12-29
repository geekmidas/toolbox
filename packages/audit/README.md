# @geekmidas/audit

> Type-safe audit logging with database integration for tracking application events and user actions

## Overview

`@geekmidas/audit` provides a comprehensive solution for recording and persisting audit trails in your application. It supports type-safe audit actions, transactional writes, and flexible storage backends.

## Features

- **Type-safe Audit Actions**: Define audit types with TypeScript for compile-time safety
- **Transactional Support**: Flush audits atomically within database transactions
- **Flexible Storage**: Pluggable storage interface (Kysely, in-memory, cache)
- **Actor Tracking**: Record who performed each action (users, services, systems)
- **Rich Metadata**: Attach request context, entity references, and custom data
- **Query Support**: Query audit logs with filters, pagination, and sorting

## Installation

```bash
npm install @geekmidas/audit
# or
pnpm add @geekmidas/audit
```

## Quick Start

### 1. Define Your Audit Actions

```typescript
import type { AuditableAction } from '@geekmidas/audit';

// Define type-safe audit actions
type AppAuditAction =
  | AuditableAction<'user.created', { userId: string; email: string }>
  | AuditableAction<'user.updated', { userId: string; changes: string[] }>
  | AuditableAction<'order.placed', { orderId: string; total: number }>;
```

### 2. Set Up Storage

**For Development/Testing (InMemoryAuditStorage):**

```typescript
import { InMemoryAuditStorage } from '@geekmidas/audit/memory';

const storage = new InMemoryAuditStorage<AppAuditAction>();

// Query stored records
const records = await storage.query({ type: 'user.created' });

// Clear all records (useful in tests)
storage.clear();
```

**For Production (KyselyAuditStorage):**

```typescript
import { KyselyAuditStorage } from '@geekmidas/audit/kysely';

// Define your database schema
interface Database {
  audit_logs: AuditLogTable;
  // ... other tables
}

const storage = new KyselyAuditStorage<Database>({
  db: kyselyDb,
  tableName: 'audit_logs',
});
```

### 3. Create an Auditor

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
```

### 4. Record Audits

```typescript
// Type-safe audit calls - TypeScript enforces correct payload shapes
auditor.audit('user.created', {
  userId: '789',
  email: 'test@example.com',
}); // OK

auditor.audit('user.created', {
  orderId: '123', // Type error - wrong payload shape
});

// Flush to storage
await auditor.flush();
```

## Transactional Audits

Use `withAuditableTransaction` to ensure audits are atomic with your database operations:

```typescript
import { withAuditableTransaction } from '@geekmidas/audit/kysely';

const result = await withAuditableTransaction(
  db,
  auditor,
  async (trx) => {
    // Database operations
    const user = await trx
      .insertInto('users')
      .values({ name: 'John', email: 'john@example.com' })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Audit is recorded
    auditor.audit('user.created', {
      userId: user.id,
      email: user.email,
    });

    return user;
  },
);
// Audits are automatically flushed before transaction commits
// If flush fails, the entire transaction rolls back
```

## API Reference

### Core Types

#### `AuditableAction<TType, TPayload>`

Defines an auditable action with a type and payload:

```typescript
type UserAction = AuditableAction<'user.created', { userId: string }>;
```

#### `AuditRecord`

Complete audit record with all metadata:

```typescript
interface AuditRecord<TPayload = unknown> {
  id: string;
  type: string;
  operation: AuditOperation;
  table?: string;
  entityId?: string | Record<string, unknown>;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  payload?: TPayload;
  timestamp: Date;
  actor?: AuditActor;
  metadata?: AuditMetadata;
}
```

#### `AuditActor`

Represents who performed the action:

```typescript
interface AuditActor {
  id?: string;
  type?: string;
  [key: string]: unknown;
}
```

#### `AuditMetadata`

Request context and additional data:

```typescript
interface AuditMetadata {
  requestId?: string;
  endpoint?: string;
  method?: string;
  ip?: string;
  userAgent?: string;
  [key: string]: unknown;
}
```

### `Auditor` Interface

```typescript
interface Auditor<TAuditAction, TTransaction> {
  readonly actor: AuditActor;

  // Type-safe audit recording
  audit<TType extends ExtractAuditType<TAuditAction>>(
    type: TType,
    payload: ExtractAuditPayload<TAuditAction, TType>,
    options?: AuditOptions,
  ): void;

  // Raw record insertion
  record(record: Omit<AuditRecord, 'id' | 'timestamp' | 'actor'>): void;

  // Get collected records
  getRecords(): AuditRecord[];

  // Flush to storage
  flush(trx?: TTransaction): Promise<void>;

  // Clear without flushing
  clear(): void;

  // Add metadata to future records
  addMetadata(metadata: AuditMetadata): void;

  // Transaction management
  setTransaction(trx: TTransaction): void;
  getTransaction(): TTransaction | undefined;
}
```

### `AuditStorage` Interface

Implement this interface for custom storage backends:

```typescript
interface AuditStorage<TAuditAction> {
  // Required: Write records
  write(records: AuditRecord[], trx?: unknown): Promise<void>;

  // Optional: Query records
  query?(options: AuditQueryOptions): Promise<AuditRecord[]>;

  // Optional: Count records
  count?(options: Omit<AuditQueryOptions, 'limit' | 'offset'>): Promise<number>;

  // Optional: Get database for transactions
  getDatabase?(): unknown;
}
```

### `KyselyAuditStorage`

Built-in Kysely storage implementation:

```typescript
const storage = new KyselyAuditStorage({
  db: kyselyDb,
  tableName: 'audit_logs',
  databaseServiceName: 'database', // Optional: for automatic transaction injection
  autoId: false, // Optional: let database generate IDs
});

// Query audits
const audits = await storage.query({
  type: 'user.created',
  actorId: 'user-123',
  from: new Date('2024-01-01'),
  limit: 100,
  orderBy: 'timestamp',
  orderDirection: 'desc',
});

// Count audits
const count = await storage.count({
  type: ['user.created', 'user.updated'],
  actorId: 'user-123',
});
```

### `InMemoryAuditStorage`

Convenience wrapper around `CacheAuditStorage` with `InMemoryCache`. Useful for testing and development:

```typescript
import { InMemoryAuditStorage } from '@geekmidas/audit/memory';

const storage = new InMemoryAuditStorage<AppAuditAction>();

// Query audits (same API as other storages)
const audits = await storage.query({
  type: 'user.created',
  limit: 10,
});

// Get all records (for assertions in tests)
const allRecords = await storage.getRecords();

// Clear all records (reset for next test)
await storage.clear();
```

### `CacheAuditStorage`

Cache-based storage using any `@geekmidas/cache` implementation:

```typescript
import { CacheAuditStorage } from '@geekmidas/audit/cache';
import { InMemoryCache } from '@geekmidas/cache/memory';
import { UpstashCache } from '@geekmidas/cache/upstash';

// With in-memory cache (development/testing)
const storage = new CacheAuditStorage({
  cache: new InMemoryCache(),
  ttl: 86400, // 24 hours
});

// With Upstash Redis (production - distributed systems)
const storage = new CacheAuditStorage({
  cache: new UpstashCache({
    url: process.env.UPSTASH_REDIS_URL,
    token: process.env.UPSTASH_REDIS_TOKEN,
  }),
  prefix: 'audit', // Optional key prefix
  ttl: 604800, // 7 days
});

// Query and count work the same as other storages
const audits = await storage.query({ type: 'user.created' });
const count = await storage.count({ actorId: 'user-123' });

// Clear all records
await storage.clear();
```

## Database Schema

Create an `audit_logs` table for `KyselyAuditStorage`:

```sql
CREATE TABLE audit_logs (
  id VARCHAR(21) PRIMARY KEY,  -- or use gen_random_uuid() with autoId: true
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

-- Recommended indexes
CREATE INDEX idx_audit_logs_type ON audit_logs(type);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs("actorId");
CREATE INDEX idx_audit_logs_entity_id ON audit_logs("entityId");
```

## Integration with @geekmidas/constructs

The audit package integrates seamlessly with `@geekmidas/constructs` endpoints:

```typescript
import { e } from '@geekmidas/constructs/endpoints';

const endpoint = e
  .post('/users')
  .body(UserSchema)
  .output(UserResponseSchema)
  .audit([
    {
      type: 'user.created',
      payload: (response) => ({
        userId: response.id,
        email: response.email,
      }),
    },
  ])
  .handle(async ({ body, auditor }) => {
    // Audits are automatically recorded and flushed
    return { id: '123', ...body };
  });
```

## Best Practices

1. **Define all audit actions upfront**: Create a union type of all possible audit actions for your application
2. **Use transactions**: Wrap database operations and audits in transactions for consistency
3. **Include entity references**: Use `entityId` and `table` options for easier querying
4. **Add request context**: Include request IDs, endpoints, and IPs in metadata
5. **Use meaningful types**: Name audit types with domain context (e.g., `order.shipped` not `update`)

## License

MIT
