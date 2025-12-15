# @geekmidas/db

Database utilities for Kysely with flexible transaction management.

## Installation

```bash
pnpm add @geekmidas/db
```

## Features

- Transaction helper that works with any DatabaseConnection type
- Handles Kysely, Transaction, and ControlledTransaction seamlessly
- Automatic transaction detection and reuse
- Type-safe database operations

## Package Exports

- `/kysely` - Kysely transaction utilities and DatabaseConnection type

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
