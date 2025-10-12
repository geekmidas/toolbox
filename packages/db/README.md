# @geekmidas/db

Database utilities for Kysely with flexible transaction management. Provides helpers for working with database connections and transactions in a type-safe way.

## Features

- ✅ **Flexible Transaction Handling**: Works with Kysely, Transaction, and ControlledTransaction
- ✅ **Automatic Transaction Detection**: Reuses existing transactions when nested
- ✅ **Type-Safe**: Full TypeScript support with generic database schemas
- ✅ **Connection Abstraction**: Single helper for all database connection types
- ✅ **Zero Dependencies**: Only peer dependency on Kysely

## Installation

```bash
pnpm add @geekmidas/db
```

### Peer Dependencies

```bash
pnpm add kysely pg
```

## Quick Start

```typescript
import { withTransaction } from '@geekmidas/db/kysely';
import type { DatabaseConnection } from '@geekmidas/db/kysely';
import { Kysely } from 'kysely';

interface Database {
  users: {
    id: string;
    email: string;
    name: string;
  };
  posts: {
    id: string;
    userId: string;
    title: string;
  };
}

async function createUserWithPost(
  db: DatabaseConnection<Database>,
  userData: { email: string; name: string },
  postData: { title: string }
) {
  return withTransaction(db, async (trx) => {
    // Create user
    const user = await trx
      .insertInto('users')
      .values(userData)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Create post for user
    const post = await trx
      .insertInto('posts')
      .values({
        userId: user.id,
        title: postData.title
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { user, post };
  });
}
```

## API Reference

### `withTransaction`

Execute a callback within a transaction. If the connection is already a transaction, it reuses it. Otherwise, it creates a new transaction.

```typescript
function withTransaction<DB, T>(
  db: DatabaseConnection<DB>,
  cb: (trx: Transaction<DB>) => Promise<T>
): Promise<T>
```

**Parameters:**
- `db` - A database connection (Kysely, Transaction, or ControlledTransaction)
- `cb` - Callback function that receives the transaction

**Returns:**
- Promise resolving to the callback's return value

### `DatabaseConnection<T>`

Type union for all supported database connection types:

```typescript
type DatabaseConnection<T> =
  | Kysely<T>
  | Transaction<T>
  | ControlledTransaction<T>;
```

## Usage Examples

### Basic Transaction

```typescript
import { withTransaction } from '@geekmidas/db/kysely';
import { Kysely } from 'kysely';

const db = new Kysely<Database>({ /* config */ });

async function transferFunds(fromId: string, toId: string, amount: number) {
  return withTransaction(db, async (trx) => {
    // Deduct from sender
    await trx
      .updateTable('accounts')
      .set({ balance: sql`balance - ${amount}` })
      .where('id', '=', fromId)
      .execute();

    // Add to receiver
    await trx
      .updateTable('accounts')
      .set({ balance: sql`balance + ${amount}` })
      .where('id', '=', toId)
      .execute();

    return { success: true };
  });
}
```

### Nested Transactions

The helper automatically detects existing transactions and reuses them:

```typescript
async function createUser(
  db: DatabaseConnection<Database>,
  email: string
) {
  return withTransaction(db, async (trx) => {
    const user = await trx
      .insertInto('users')
      .values({ email })
      .returningAll()
      .executeTakeFirstOrThrow();

    // This will reuse the same transaction
    await createAuditLog(trx, 'user_created', user.id);

    return user;
  });
}

async function createAuditLog(
  db: DatabaseConnection<Database>,
  action: string,
  userId: string
) {
  // If db is already a transaction, it's reused
  return withTransaction(db, async (trx) => {
    await trx
      .insertInto('audit_logs')
      .values({ action, userId, timestamp: new Date() })
      .execute();
  });
}
```

### Repository Pattern

Use `DatabaseConnection` type in repositories for flexibility:

```typescript
import type { DatabaseConnection } from '@geekmidas/db/kysely';
import { withTransaction } from '@geekmidas/db/kysely';

class UserRepository {
  constructor(private db: DatabaseConnection<Database>) {}

  async create(data: NewUser): Promise<User> {
    return withTransaction(this.db, async (trx) => {
      return trx
        .insertInto('users')
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async update(id: string, data: UserUpdate): Promise<User> {
    return withTransaction(this.db, async (trx) => {
      return trx
        .updateTable('users')
        .set(data)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }
}

// Can be used with any connection type
const db = new Kysely<Database>({ /* config */ });
const repo = new UserRepository(db);

// Or within a transaction
await withTransaction(db, async (trx) => {
  const repo = new UserRepository(trx);
  await repo.create({ email: 'user@example.com' });
});
```

### Service Pattern with Transactions

```typescript
import type { DatabaseConnection } from '@geekmidas/db/kysely';
import { withTransaction } from '@geekmidas/db/kysely';

class OrderService {
  constructor(
    private db: DatabaseConnection<Database>,
    private inventoryService: InventoryService,
    private paymentService: PaymentService
  ) {}

  async createOrder(
    userId: string,
    items: OrderItem[]
  ): Promise<Order> {
    return withTransaction(this.db, async (trx) => {
      // All operations share the same transaction
      const order = await trx
        .insertInto('orders')
        .values({ userId, status: 'pending' })
        .returningAll()
        .executeTakeFirstOrThrow();

      // These services can accept the transaction
      await this.inventoryService.reserveItems(trx, items);
      await this.paymentService.processPayment(trx, order.id);

      // Update order status
      return trx
        .updateTable('orders')
        .set({ status: 'completed' })
        .where('id', '=', order.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }
}

class InventoryService {
  async reserveItems(
    db: DatabaseConnection<Database>,
    items: OrderItem[]
  ) {
    return withTransaction(db, async (trx) => {
      for (const item of items) {
        await trx
          .updateTable('inventory')
          .set({ reserved: sql`reserved + ${item.quantity}` })
          .where('productId', '=', item.productId)
          .execute();
      }
    });
  }
}
```

### Error Handling

Transactions automatically roll back on errors:

```typescript
import { withTransaction } from '@geekmidas/db/kysely';

async function processOrder(db: DatabaseConnection<Database>, orderId: string) {
  try {
    return await withTransaction(db, async (trx) => {
      const order = await trx
        .selectFrom('orders')
        .where('id', '=', orderId)
        .selectAll()
        .executeTakeFirstOrThrow();

      if (order.status !== 'pending') {
        throw new Error('Order already processed');
      }

      // Update order
      await trx
        .updateTable('orders')
        .set({ status: 'processing' })
        .where('id', '=', orderId)
        .execute();

      // If this throws, the entire transaction rolls back
      await processPayment(trx, orderId);

      return order;
    });
  } catch (error) {
    console.error('Transaction failed:', error);
    // Transaction has been rolled back
    throw error;
  }
}
```

### Testing with Transactions

Use transactions for test isolation:

```typescript
import { describe, it, beforeEach, afterEach } from 'vitest';
import type { Transaction } from 'kysely';

describe('UserRepository', () => {
  let trx: Transaction<Database>;

  beforeEach(async () => {
    trx = await db.transaction().execute(async (t) => t);
  });

  afterEach(async () => {
    await trx.rollback();
  });

  it('should create user', async () => {
    const repo = new UserRepository(trx);
    const user = await repo.create({ email: 'test@example.com' });

    expect(user.email).toBe('test@example.com');
    // Transaction will be rolled back after test
  });
});
```

## Type Safety

The package provides full type safety for database operations:

```typescript
import type { DatabaseConnection } from '@geekmidas/db/kysely';
import { withTransaction } from '@geekmidas/db/kysely';

interface Database {
  users: {
    id: Generated<string>;
    email: string;
    name: string | null;
  };
}

function updateUser(
  db: DatabaseConnection<Database>,
  id: string,
  data: { name: string }
) {
  return withTransaction(db, async (trx) => {
    // Full autocomplete and type checking
    return trx
      .updateTable('users')
      .set(data) // Type-checked against users table
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}
```

## Advanced Patterns

### Unit of Work Pattern

```typescript
class UnitOfWork {
  private transaction: Transaction<Database> | null = null;

  constructor(private db: Kysely<Database>) {}

  async begin() {
    this.transaction = await this.db.transaction().execute(async (t) => t);
  }

  async commit() {
    if (this.transaction) {
      await this.transaction.commit();
      this.transaction = null;
    }
  }

  async rollback() {
    if (this.transaction) {
      await this.transaction.rollback();
      this.transaction = null;
    }
  }

  getConnection(): DatabaseConnection<Database> {
    return this.transaction || this.db;
  }
}

// Usage
const uow = new UnitOfWork(db);
await uow.begin();

try {
  const userRepo = new UserRepository(uow.getConnection());
  const orderRepo = new OrderRepository(uow.getConnection());

  await userRepo.create({ email: 'user@example.com' });
  await orderRepo.create({ userId: '123' });

  await uow.commit();
} catch (error) {
  await uow.rollback();
  throw error;
}
```

### Connection Pooling

```typescript
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';

const pool = new Pool({
  host: 'localhost',
  database: 'mydb',
  max: 10
});

const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool })
});

// Use with withTransaction
async function processData(data: unknown[]) {
  return withTransaction(db, async (trx) => {
    // Each transaction gets a connection from the pool
    for (const item of data) {
      await trx.insertInto('items').values(item).execute();
    }
  });
}
```

## Best Practices

1. **Use DatabaseConnection Type**: Accept `DatabaseConnection` in functions that work with transactions
   ```typescript
   async function myFunction(db: DatabaseConnection<Database>) { }
   ```

2. **Let withTransaction Handle Reuse**: Don't manually check for transaction type
   ```typescript
   // Good
   await withTransaction(db, async (trx) => { });

   // Avoid
   if (db.isTransaction) { /* ... */ } else { /* ... */ }
   ```

3. **Keep Transactions Short**: Execute quickly to avoid blocking
   ```typescript
   // Good
   await withTransaction(db, async (trx) => {
     await trx.insertInto('users').values(data).execute();
   });

   // Avoid long-running operations
   await withTransaction(db, async (trx) => {
     await fetch('https://api.example.com'); // Bad!
   });
   ```

4. **Error Handling**: Let transactions roll back automatically on errors

5. **Testing**: Use transactions for test isolation with automatic rollback

## Related Packages

- [Kysely](https://github.com/kysely-org/kysely) - Type-safe SQL query builder
- [@geekmidas/testkit](../testkit) - Testing utilities with database factories

## License

MIT
