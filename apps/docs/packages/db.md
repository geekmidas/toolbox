# @geekmidas/db

Database utilities for Kysely with flexible transaction management and Row Level Security (RLS) support.

## Installation

```bash
pnpm add @geekmidas/db
```

## Features

- Transaction helper that works with any DatabaseConnection type
- Handles Kysely, Transaction, and ControlledTransaction seamlessly
- Automatic transaction detection and reuse
- Type-safe database operations
- **Row Level Security (RLS)** context management for PostgreSQL

## Package Exports

- `/kysely` - Kysely transaction utilities, DatabaseConnection type, and RLS helpers

## Basic Usage

### Transaction Helper

```typescript
import { withTransaction } from '@geekmidas/db/kysely';
import type { DatabaseConnection } from '@geekmidas/db/kysely';

interface Database {
  users: UsersTable;
  audit_log: AuditLogTable;
}

async function createUser(
  db: DatabaseConnection<Database>,
  data: UserData
) {
  return withTransaction(db, async (trx) => {
    // All operations in this callback are transactional
    const user = await trx
      .insertInto('users')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('audit_log')
      .values({
        userId: user.id,
        action: 'created',
        timestamp: new Date(),
      })
      .execute();

    return user;
  });
}
```

### DatabaseConnection Type

The `DatabaseConnection` type accepts any of:
- `Kysely<T>` - Standard Kysely instance
- `Transaction<T>` - Kysely transaction
- `ControlledTransaction<T>` - Controlled transaction

```typescript
import type { DatabaseConnection } from '@geekmidas/db/kysely';
import { Kysely, Transaction } from 'kysely';

// Works with Kysely instance
const db: Kysely<Database> = createDb();
await createUser(db, userData);

// Also works with existing transaction
await db.transaction().execute(async (trx) => {
  // trx is reused, not nested
  await createUser(trx, userData);
  await createOrder(trx, orderData);
});
```

### Transaction Reuse

`withTransaction` automatically detects if already in a transaction:

```typescript
async function createUserWithProfile(db: DatabaseConnection<Database>, data: UserData) {
  return withTransaction(db, async (trx) => {
    const user = await createUser(trx, data);  // Reuses same transaction
    const profile = await createProfile(trx, { userId: user.id });
    return { user, profile };
  });
}
```

### Isolation Levels

```typescript
import { withTransaction } from '@geekmidas/db/kysely';

await withTransaction(db, async (trx) => {
  // Your transactional operations
}, {
  isolationLevel: 'serializable',
});
```

## Usage with Services

```typescript
import type { Service } from '@geekmidas/services';
import { Kysely, PostgresDialect } from 'kysely';

const databaseService = {
  serviceName: 'database' as const,
  async register(envParser) {
    const config = envParser.create((get) => ({
      connectionString: get('DATABASE_URL').string(),
    })).parse();

    return new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: config.connectionString }),
      }),
    });
  }
} satisfies Service<'database', Kysely<Database>>;
```

## Row Level Security (RLS)

PostgreSQL Row Level Security allows you to restrict which rows users can access based on session variables. The `withRlsContext` helper sets these variables within a transaction.

### Basic RLS Usage

```typescript
import { withRlsContext } from '@geekmidas/db/kysely';

// Execute queries with RLS context
const orders = await withRlsContext(
  db,
  { user_id: session.userId, tenant_id: session.tenantId },
  async (trx) => {
    // PostgreSQL policies can now use:
    // current_setting('app.user_id')
    // current_setting('app.tenant_id')
    return trx.selectFrom('orders').selectAll().execute();
  }
);
```

### How It Works

1. **Transaction Scope**: Variables are set using `SET LOCAL` which scopes them to the current transaction
2. **Automatic Cleanup**: Variables are automatically cleared when the transaction ends (commit or rollback)
3. **Custom Prefix**: Default prefix is `app`, configurable via options

### PostgreSQL Policy Example

```sql
-- Create RLS policy that uses session variables
CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY user_access ON orders
  USING (user_id = current_setting('app.user_id', true));

-- Enable RLS on the table
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
```

### Custom Prefix

```typescript
await withRlsContext(
  db,
  { user_id: 'user-123' },
  async (trx) => {
    // Uses 'rls.user_id' instead of 'app.user_id'
    return trx.selectFrom('orders').selectAll().execute();
  },
  { prefix: 'rls' }
);
```

### Isolation Levels

```typescript
await withRlsContext(
  db,
  { user_id: session.userId },
  async (trx) => {
    // Your queries here
  },
  { settings: { isolationLevel: 'serializable' } }
);
```

### Nested RLS Contexts

When nesting `withRlsContext` calls, the same transaction is reused and all variables accumulate:

```typescript
await withRlsContext(
  db,
  { tenant_id: 'tenant-1' },
  async (outerTrx) => {
    // Both tenant_id and user_id are available here
    return withRlsContext(
      outerTrx,
      { user_id: 'user-123' },
      async (innerTrx) => {
        return innerTrx.selectFrom('orders').selectAll().execute();
      }
    );
  }
);
```

### Value Types

The RLS context accepts various value types:

```typescript
const context: RlsContext = {
  user_id: 'user-123',      // string
  count: 42,                 // number (converted to string)
  is_admin: true,            // boolean (converted to 'true'/'false')
  optional: null,            // null/undefined values are skipped
};
```

### RLS Bypass

For admin operations that need to bypass RLS:

```typescript
import { RLS_BYPASS } from '@geekmidas/db/kysely';

// Use RLS_BYPASS symbol to skip RLS context
const allOrders = await db.selectFrom('orders').selectAll().execute();
```

## RLS with Endpoints

When using `@geekmidas/constructs`, RLS integrates seamlessly with endpoints:

```typescript
import { EndpointFactory } from '@geekmidas/constructs/endpoints';

const api = new EndpointFactory()
  .services([databaseService])
  .authorizer('jwt')
  .rls({
    extractor: ({ session }) => ({
      user_id: session.sub,
      tenant_id: session.tenantId,
    }),
    prefix: 'app',
  });

// All endpoints inherit RLS configuration
const listOrders = api
  .get('/orders')
  .handle(async ({ services }) => {
    // RLS context is automatically applied
    return services.database
      .selectFrom('orders')
      .selectAll()
      .execute();
  });

// Bypass RLS for specific endpoints
const adminListOrders = api
  .get('/admin/orders')
  .rls(false)  // Disable RLS for this endpoint
  .handle(async ({ services }) => {
    return services.database
      .selectFrom('orders')
      .selectAll()
      .execute();
  });
```

### Per-Endpoint RLS

```typescript
import { e } from '@geekmidas/constructs/endpoints';

const endpoint = e
  .get('/orders')
  .services([databaseService])
  .rls({
    extractor: ({ session, header }) => ({
      user_id: session.userId,
      ip_address: header('x-forwarded-for'),
    }),
  })
  .handle(async ({ services }) => {
    return services.database
      .selectFrom('orders')
      .selectAll()
      .execute();
  });
```
