# @geekmidas/audit - Technical Documentation

## Overview

The `@geekmidas/audit` package provides a transaction-aware audit system for tracking database mutations. Unlike event publishing (which happens after a transaction commits), audits run **inside** the same transaction as the mutation, ensuring audit records are atomically committed or rolled back with the data they describe.

**Key Design Principle**: The core audit package is **database-agnostic**. Provider-specific wrappers (Kysely, Objection, Knex, MongoDB) are separate subpath exports that users opt into.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     @geekmidas/audit                            │
├─────────────────────────────────────────────────────────────────┤
│  Core (database-agnostic)          │  Provider Wrappers         │
│  ─────────────────────────         │  ──────────────────        │
│  • Auditor interface               │  • /kysely                 │
│  • DefaultAuditor                  │  • /objection (future)     │
│  • AuditRecord types               │  • /knex (future)          │
│  • AuditStorage interface          │  • /mongo (future)         │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Endpoint Integration                            │
│  • .auditor() builder method                                    │
│  • .audit() declarative audits                                  │
│  • ctx.auditor in handlers                                      │
│  • Automatic flush after handler                                │
└─────────────────────────────────────────────────────────────────┘
```

## Why Provider-Agnostic?

The audit system supports multiple database technologies:

| Provider | Status | Import Path |
|----------|--------|-------------|
| Kysely | Implemented | `@geekmidas/audit/kysely` |
| Objection.js | Future | `@geekmidas/audit/objection` |
| Knex | Future | `@geekmidas/audit/knex` |
| MongoDB | Future | `@geekmidas/audit/mongo` |
| Drizzle | Future | `@geekmidas/audit/drizzle` |

Users explicitly wrap their database with the appropriate provider wrapper. The endpoint adaptor **does not** automatically wrap services.

## Request Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        HTTP Request                              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    HonoEndpointAdaptor                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. Create Auditor (if .auditor() was called)              │  │
│  │ 2. Pass auditor to handler context                        │  │
│  │    (NO automatic database wrapping)                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Endpoint Handler                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ // User explicitly wraps database (provider-specific)     │  │
│  │ const db = new AuditableKysely(services.database, auditor);│  │
│  │                                                            │  │
│  │ // Auto-captured audit (via wrapper)                      │  │
│  │ await db.updateTable('users').set({ name: 'New' }).execute()│  │
│  │                                                            │  │
│  │ // Manual audit (via context)                             │  │
│  │ auditor.audit('custom.action', { ... });                  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    After Handler Execution                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. Process declarative .audit() definitions               │  │
│  │ 2. Flush all collected audits to storage                  │  │
│  │    (INSIDE the transaction)                               │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Core Types

### AuditRecord

The fundamental unit of audit data:

```typescript
type AuditOperation = 'INSERT' | 'UPDATE' | 'DELETE' | 'CUSTOM';

interface AuditRecord<TPayload = unknown> {
  // Identity
  id: string;                    // Unique identifier (nanoid)
  type: string;                  // Audit type (e.g., 'user.updated')

  // Operation details
  operation: AuditOperation;     // What kind of operation
  table?: string;                // Database table (for DB operations)
  entityId?: string | Record<string, unknown>;  // Primary key(s)

  // Change tracking
  oldValues?: Record<string, unknown>;  // Previous state (UPDATE/DELETE)
  newValues?: Record<string, unknown>;  // New state (INSERT/UPDATE)
  payload?: TPayload;                   // Custom payload (CUSTOM operations)

  // Context
  timestamp: Date;               // When the audit was recorded
  actor?: AuditActor;           // Who performed the action
  metadata?: AuditMetadata;     // Request context
}

interface AuditActor {
  id?: string;                  // User/service ID
  type?: string;                // 'user', 'system', 'service', etc.
  [key: string]: unknown;       // Extensible for custom fields
}

interface AuditMetadata {
  requestId?: string;           // Correlation ID
  endpoint?: string;            // Which endpoint was called
  method?: string;              // HTTP method
  ip?: string;                  // Client IP
  userAgent?: string;           // Client user agent
  [key: string]: unknown;       // Extensible
}
```

### Auditor Interface

The core abstraction for audit collection. **Generic and extensible** - create custom implementations:

```typescript
interface Auditor<TRecord = AuditRecord> {
  /**
   * The actor for all audits in this context.
   * Set at construction time via the actor extractor, immutable.
   */
  readonly actor: AuditActor;

  /**
   * Record a custom audit entry.
   * Use this for application-level audits that aren't database operations.
   */
  audit<TPayload = unknown>(
    type: string,
    payload: TPayload,
    options?: AuditOptions
  ): void;

  /**
   * Record a raw audit record.
   * Use this when you need full control over the audit structure.
   */
  record(record: Omit<TRecord, 'id' | 'timestamp' | 'actor'>): void;

  /**
   * Get all collected audit records.
   */
  getRecords(): TRecord[];

  /**
   * Flush all collected audits to storage.
   * Called automatically by the endpoint adaptor inside the transaction.
   */
  flush(trx?: unknown): Promise<void>;
}

interface AuditOptions {
  entityId?: string | Record<string, unknown>;
  table?: string;
  operation?: AuditOperation;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}
```

### AuditStorage Interface

Pluggable storage backend:

```typescript
interface AuditStorage {
  /**
   * Write audit records to storage.
   * @param records - The audit records to write
   * @param trx - Transaction context (if writing to same DB)
   */
  write(records: AuditRecord[], trx?: unknown): Promise<void>;

  /**
   * Optional: Query audit records for retrieval.
   */
  query?(options: AuditQueryOptions): Promise<AuditRecord[]>;
}
```

## Three Ways to Audit

### 1. Manual Auditing (via Context)

For explicit control or non-database operations:

```typescript
const processOrder = e
  .post('/orders')
  .services([databaseService, paymentService])
  .auditor(auditStorageService)
  .handle(async ({ body, services, auditor }) => {
    // Database operation (not auto-audited without wrapper)
    const order = await services.database
      .insertInto('orders')
      .values(body)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Manual audit for external service call
    const paymentResult = await services.payment.charge(order.total);
    auditor.audit('payment.charged', {
      orderId: order.id,
      amount: order.total,
      transactionId: paymentResult.transactionId,
    });

    // Conditional audit
    if (order.total > 10000) {
      auditor.audit('order.high_value', {
        orderId: order.id,
        total: order.total,
        requiresReview: true,
      });
    }

    return order;
  });
```

### 2. Declarative Auditing (Builder Pattern)

Similar to events, declare audits on the endpoint:

```typescript
const createUser = e
  .post('/users')
  .services([databaseService])
  .auditor(auditStorageService)
  .body(createUserSchema)
  .output(userSchema)
  // Declarative audit - processed after handler returns
  .audit({
    type: 'user.created',
    payload: (response) => ({
      userId: response.id,
      email: response.email
    }),
    // Optional: only audit under certain conditions
    when: (response) => response.role !== 'system',
    // Optional: specify entity ID for easier querying
    entityId: (response) => response.id,
    table: 'users',
  })
  .handle(async ({ body, services }) => {
    return await services.database
      .insertInto('users')
      .values(body)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
```

### 3. Automatic Database Auditing (Provider Wrappers)

User explicitly wraps their database with a provider-specific wrapper:

```typescript
import { AuditableKysely } from '@geekmidas/audit/kysely';

const updateUser = e
  .put('/users/:id')
  .services([databaseService])
  // Actor extractor has full handler context
  .auditor(auditStorageService, ({ session, header }) => ({
    id: session.userId,
    type: 'user',
    ip: header('x-forwarded-for'),
  }))
  .handle(async ({ params, body, services, auditor }) => {
    // User explicitly wraps database
    const db = new AuditableKysely(services.database, auditor, {
      excludeTables: ['audit_logs'],
    });

    // This UPDATE is automatically audited:
    // - Old values fetched before update
    // - New values captured after update
    // - Audit record includes table, entityId, oldValues, newValues
    // - Actor automatically set from session
    return await db
      .updateTable('users')
      .set(body)
      .where('id', '=', params.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
```

## Service Factory Pattern (Recommended)

Create a service that provides an auditable wrapper factory:

```typescript
// services/database.ts
import { AuditableKysely } from '@geekmidas/audit/kysely';
import type { Auditor } from '@geekmidas/audit';

interface DatabaseService {
  raw: Kysely<Database>;
  withAuditor: (auditor: Auditor) => AuditableKysely<Database>;
}

const databaseService = {
  serviceName: 'database' as const,
  async register(envParser) {
    const db = createKyselyConnection(envParser);
    return {
      raw: db,
      withAuditor: (auditor: Auditor) => new AuditableKysely(db, auditor),
    };
  },
} satisfies Service<'database', DatabaseService>;
```

Usage in endpoints:

```typescript
const updateUser = e
  .put('/users/:id')
  .services([databaseService])
  .auditor(auditStorageService)
  .handle(async ({ params, body, services, auditor }) => {
    // Clean one-liner to get auditable database
    const db = services.database.withAuditor(auditor);

    return await db
      .updateTable('users')
      .set(body)
      .where('id', '=', params.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
```

## Provider Wrapper: AuditableKysely

### Overview

`AuditableKysely` wraps a Kysely instance to intercept INSERT/UPDATE/DELETE operations:

```typescript
import { AuditableKysely } from '@geekmidas/audit/kysely';

const auditableDb = new AuditableKysely(db, auditor, {
  excludeTables: ['audit_logs', 'sessions'],
  getPrimaryKey: (table, record) => record.id,
});
```

### Configuration

```typescript
interface AuditableKyselyConfig<DB> {
  /**
   * Tables to exclude from automatic auditing.
   * Use to prevent recursion or skip high-volume tables.
   */
  excludeTables?: (keyof DB)[];

  /**
   * Custom primary key extractor.
   * Default: looks for 'id' field.
   */
  getPrimaryKey?: (
    table: keyof DB,
    record: unknown
  ) => string | Record<string, unknown>;
}
```

### How Operations Are Intercepted

**INSERT:**
```typescript
// User code
await db.insertInto('users').values({ name: 'John' }).execute();

// Internally:
// 1. Execute INSERT
// 2. Record audit with operation='INSERT', newValues={name:'John'}
```

**UPDATE:**
```typescript
// User code
await db.updateTable('users').set({ name: 'Jane' }).where('id', '=', '123').execute();

// Internally:
// 1. SELECT * FROM users WHERE id = '123' (capture old values)
// 2. Execute UPDATE
// 3. SELECT * FROM users WHERE id = '123' (capture new values)
// 4. Record audit with oldValues, newValues
```

**DELETE:**
```typescript
// User code
await db.deleteFrom('users').where('id', '=', '123').execute();

// Internally:
// 1. SELECT * FROM users WHERE id = '123' (capture old values)
// 2. Execute DELETE
// 3. Record audit with operation='DELETE', oldValues
```

### Supported Methods

```typescript
class AuditableKysely<DB> {
  // Wrapped (audited)
  insertInto<T>(table: T): AuditableInsertQueryBuilder;
  updateTable<T>(table: T): AuditableUpdateQueryBuilder;
  deleteFrom<T>(table: T): AuditableDeleteQueryBuilder;

  // Pass-through (not audited)
  selectFrom<T>(table: T): SelectQueryBuilder;
  with(...): WithBuilder;

  // Access raw db for edge cases
  get raw(): Kysely<DB> | Transaction<DB>;
}
```

## Future Provider Wrappers

### Objection.js (Future)

```typescript
import { AuditableObjection } from '@geekmidas/audit/objection';

const User = new AuditableObjection(UserModel, auditor);

await User.query()
  .patchAndFetchById(params.id, body);
```

### Knex (Future)

```typescript
import { AuditableKnex } from '@geekmidas/audit/knex';

const db = new AuditableKnex(knex, auditor);

await db('users')
  .where('id', params.id)
  .update(body);
```

### MongoDB (Future)

```typescript
import { AuditableMongo } from '@geekmidas/audit/mongo';

const db = new AuditableMongo(mongoClient, auditor);

await db.collection('users')
  .findOneAndUpdate(
    { _id: params.id },
    { $set: body },
    { returnDocument: 'after' }
  );
```

## Storage Implementations

### Same Database Storage (Recommended)

Store audits in the same database for transactional consistency:

```typescript
const auditStorageService = {
  serviceName: 'auditStorage' as const,
  async register(envParser) {
    return {
      async write(records, trx) {
        if (records.length === 0) return;

        // Use transaction if provided
        const db = trx ?? getDatabase();

        await db
          .insertInto('audit_logs')
          .values(records.map(r => ({
            id: r.id,
            type: r.type,
            operation: r.operation,
            table_name: r.table,
            entity_id: JSON.stringify(r.entityId),
            old_values: r.oldValues ? JSON.stringify(r.oldValues) : null,
            new_values: r.newValues ? JSON.stringify(r.newValues) : null,
            payload: r.payload ? JSON.stringify(r.payload) : null,
            actor_id: r.actor?.id,
            actor_type: r.actor?.type,
            metadata: r.metadata ? JSON.stringify(r.metadata) : null,
            created_at: r.timestamp,
          })))
          .execute();
      },
    } satisfies AuditStorage;
  },
} satisfies Service<'auditStorage', AuditStorage>;
```

### External Audit Service

For compliance or separate audit systems:

```typescript
const externalAuditService = {
  serviceName: 'auditStorage' as const,
  async register(envParser) {
    const config = envParser.create((get) => ({
      auditServiceUrl: get('AUDIT_SERVICE_URL').string(),
      apiKey: get('AUDIT_API_KEY').string(),
    })).parse();

    return {
      async write(records, _trx) {
        // Note: External writes can't participate in the transaction
        // Consider using outbox pattern for guaranteed delivery
        await fetch(`${config.auditServiceUrl}/audits`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({ records }),
        });
      },
    } satisfies AuditStorage;
  },
};
```

## Custom Auditor Implementations

The `Auditor` interface is generic, allowing custom implementations:

### Filtered Auditor

Only audit certain operations:

```typescript
class FilteredAuditor implements Auditor {
  constructor(
    private readonly inner: Auditor,
    private readonly filter: (record: AuditRecord) => boolean
  ) {}

  get actor(): AuditActor {
    return this.inner.actor;
  }

  audit<T>(type: string, payload: T, options?: AuditOptions): void {
    this.inner.audit(type, payload, options);
  }

  record(record: Omit<AuditRecord, 'id' | 'timestamp' | 'actor'>): void {
    this.inner.record(record);
  }

  getRecords(): AuditRecord[] {
    return this.inner.getRecords().filter(this.filter);
  }

  async flush(trx?: unknown): Promise<void> {
    // Only flush filtered records
    // ...
  }
}
```

### Enriched Auditor

Add extra context to all audits:

```typescript
class EnrichedAuditor implements Auditor {
  constructor(
    private readonly inner: Auditor,
    private readonly enrichment: Record<string, unknown>
  ) {}

  get actor(): AuditActor {
    return this.inner.actor;
  }

  audit<T>(type: string, payload: T, options?: AuditOptions): void {
    this.inner.audit(type, { ...payload, ...this.enrichment }, options);
  }

  // ... delegate other methods
}
```

## Transaction Integration

### Key Principle

Audits are flushed **inside** the transaction, ensuring atomicity:

```typescript
// In HonoEndpointAdaptor
const response = await endpoint.handler({ services, auditor }, responseBuilder);

// Process declarative audits
for (const audit of endpoint.audits) {
  if (!audit.when || audit.when(response)) {
    auditor.audit(audit.type, audit.payload(response), {
      entityId: audit.entityId?.(response),
      table: audit.table
    });
  }
}

// CRITICAL: Flush inside transaction
await auditor.flush(transaction);
// If flush fails → entire transaction rolls back
// If mutation fails → audits never written
```

### Explicit Transaction Handling

When you manage transactions explicitly:

```typescript
const transferFunds = e
  .post('/transfers')
  .services([databaseService])
  .auditor(auditStorageService)
  .handle(async ({ body, services, auditor }) => {
    return await withTransaction(services.database.raw, async (trx) => {
      // Wrap transaction with auditable layer
      const db = new AuditableKysely(trx, auditor);

      // Debit
      await db
        .updateTable('accounts')
        .set({ balance: sql`balance - ${body.amount}` })
        .where('id', '=', body.fromAccountId)
        .execute();

      // Credit
      await db
        .updateTable('accounts')
        .set({ balance: sql`balance + ${body.amount}` })
        .where('id', '=', body.toAccountId)
        .execute();

      // Manual audit for the transfer as a whole
      auditor.audit('transfer.completed', {
        fromAccountId: body.fromAccountId,
        toAccountId: body.toAccountId,
        amount: body.amount,
      });

      // Flush audits INSIDE the transaction
      await auditor.flush(trx);

      return { success: true };
    });
  });
```

## Endpoint Integration

### EndpointBuilder Methods

```typescript
// Add auditor service with actor extractor
// Actor function has access to full handler context
.auditor(auditStorageService, ({ session, header, services, logger }) => ({
  id: session?.userId,
  type: session ? 'user' : 'anonymous',
  ip: header('x-forwarded-for'),
}))

// Add declarative audit
.audit({
  type: 'user.created',
  payload: (response) => ({ userId: response.id }),
  when: (response) => response.active,
  entityId: (response) => response.id,
  table: 'users',
})
```

### Actor Extractor Type

The actor extractor function is **required** and receives the same context as the handler:

```typescript
type ActorExtractor<TServices, TSession, TLogger> = (ctx: {
  services: ServiceRecord<TServices>;
  session: TSession;
  header: HeaderFn;
  cookie: CookieFn;
  logger: TLogger;
}) => AuditActor | Promise<AuditActor>;

// Usage - actor function is required!
.auditor(auditStorageService, ({ session, header }) => ({
  id: session.userId,
  type: 'user',
  ip: header('x-forwarded-for'),
}))
```

This design ensures:
- **Every audit has an actor** - No audits without attribution
- **Immutable actor** - Actor is set once at request start, can't be changed
- **Full context access** - Extract from session, headers, services, etc.
- **Async support** - Look up additional user data if needed

### EndpointContext

When `.auditor()` is called, `auditor` is **guaranteed** to exist (not optional):

```typescript
// Without .auditor() - auditor is undefined
.handle(async ({ services }) => {
  // auditor not available
});

// With .auditor() - auditor is guaranteed
.handle(async ({ services, auditor }) => {
  // auditor: Auditor (not optional!)
  auditor.audit('action', { data: 'value' });
});
```

## Performance Considerations

### Extra SELECT for Old Values

UPDATE/DELETE require fetching old values:

```
UPDATE users SET name = 'New' WHERE id = '123'

Becomes:
1. SELECT * FROM users WHERE id = '123'  ← Extra query
2. UPDATE users SET name = 'New' WHERE id = '123'
3. SELECT * FROM users WHERE id = '123'  ← For new values (or use RETURNING)
```

**Mitigations:**
1. **Use RETURNING**: Avoid extra SELECT for new values
2. **Exclude high-volume tables**: `excludeTables: ['logs', 'metrics']`
3. **Index WHERE columns**: Ensure efficient lookups
4. **Use declarative audits**: For simple cases, skip auto-capture

### Memory Usage

Records held in memory until flush:

```typescript
// 1000 inserts = ~1000 AuditRecord objects
// Each ~200-500 bytes
// Total: ~200KB-500KB per request

// For bulk operations, consider:
// 1. Periodic flushing during operation
// 2. Batch-level auditing instead of row-level
```

## Package Exports

```typescript
// Core (database-agnostic)
import {
  Auditor,
  DefaultAuditor,
  AuditRecord,
  AuditStorage,
  AuditActor,
  AuditMetadata,
} from '@geekmidas/audit';

// Kysely provider
import { AuditableKysely } from '@geekmidas/audit/kysely';

// Future providers
import { AuditableObjection } from '@geekmidas/audit/objection';
import { AuditableKnex } from '@geekmidas/audit/knex';
import { AuditableMongo } from '@geekmidas/audit/mongo';
```

## File Structure

```
packages/audit/
├── src/
│   ├── index.ts                 # Core exports
│   ├── types.ts                 # AuditRecord, AuditActor, etc.
│   ├── Auditor.ts               # Auditor interface
│   ├── DefaultAuditor.ts        # Default implementation
│   ├── storage.ts               # AuditStorage interface
│   ├── kysely/                  # Kysely provider
│   │   ├── index.ts
│   │   ├── AuditableKysely.ts
│   │   └── builders/
│   │       ├── AuditableInsertBuilder.ts
│   │       ├── AuditableUpdateBuilder.ts
│   │       └── AuditableDeleteBuilder.ts
│   └── __tests__/
├── package.json                 # With subpath exports
├── tsconfig.json
└── TECHNICAL.md                 # This file
```

## Summary

The `@geekmidas/audit` package provides:

1. **Transaction-safe auditing** - Audits commit/rollback with mutations
2. **Database-agnostic core** - Provider wrappers are separate subpath imports
3. **Three audit methods** - Manual (context), declarative (builder), automatic (wrapper)
4. **Required actor** - Every audit has attribution via required actor extractor
5. **Immutable actor** - Actor set once at request start, cannot be changed
6. **Extensible architecture** - Generic `Auditor` interface for custom implementations
7. **Full change tracking** - Old values, new values, actor, metadata
8. **Pluggable storage** - Same DB, external service, or custom
9. **Type-safe** - Full TypeScript inference throughout
