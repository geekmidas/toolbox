# @geekmidas/testkit

Testing utilities focused on database factories for test data creation.

## Installation

```bash
pnpm add -D @geekmidas/testkit
```

## Features

- ✅ Factory pattern for test data
- ✅ Support for Kysely and Objection.js
- ✅ Type-safe builders with schema inference
- ✅ Transaction-based test isolation
- ✅ Batch operations support
- ✅ Database migration utilities
- ✅ Complex seed scenarios
- ✅ Enhanced faker with timestamps, sequences, and coordinates

## Package Exports

| Export | Description |
|--------|-------------|
| `/kysely` | `KyselyFactory` - database factories for Kysely |
| `/objection` | Factory for Objection.js |
| `/faker` | Enhanced faker with timestamps, sequences, coordinates, prices |
| `/timer` | Async wait utilities for testing |
| `/os` | Directory operation helpers for tests |
| `/aws` | AWS testing utilities |
| `/logger` | Logger testing utilities |
| `/better-auth` | Better Auth testing utilities |
| `/benchmark` | Test data generators for benchmarks |
| `/postgres` | `runInitScript` - parse and execute PostgreSQL init scripts |
| `/request-context` | Vitest helpers for running tests inside `runWithRequestContext` |

## Kysely Factory

### Builders

Use `createBuilder` to define type-safe builders that receive `{ attrs, faker, factory, db }`:

```typescript
import { KyselyFactory } from '@geekmidas/testkit/kysely';

interface Database {
  users: { id: string; name: string; email: string; createdAt: Date };
  posts: { id: string; title: string; userId: string };
}

const builders = {
  user: KyselyFactory.createBuilder<Database, 'users'>('users',
    ({ attrs, faker }) => ({
      id: faker.string.uuid(),
      name: faker.person.fullName(),
      email: faker.internet.email(),
      createdAt: new Date(),
      ...attrs,
    })
  ),
  post: KyselyFactory.createBuilder<Database, 'posts'>('posts',
    ({ attrs, faker }) => ({
      id: faker.string.uuid(),
      title: faker.lorem.sentence(),
      ...attrs,
    })
  ),
};

const factory = new KyselyFactory(builders, {}, db);

// Insert single record
const user = await factory.insert('user', { name: 'John Doe' });

// Insert multiple records
const posts = await factory.insertMany(3, 'post', { userId: user.id });

// Insert with dynamic attributes
const users = await factory.insertMany(5, 'user', (idx, faker) => ({
  email: `user${idx}@example.com`,
}));
```

### Seeds

Use `createSeed` to define type-safe seed functions that receive `{ attrs, factory, db }`:

```typescript
const seeds = {
  userWithPosts: KyselyFactory.createSeed(
    async ({ attrs, factory }: {
      attrs: { postCount?: number };
      factory: KyselyFactory<Database, typeof builders, {}>;
      db: Kysely<Database>;
    }) => {
      const user = await factory.insert('user');
      const posts = await factory.insertMany(
        attrs.postCount || 3,
        'post',
        { userId: user.id }
      );
      return { user, posts };
    }
  ),
};

const factory = new KyselyFactory(builders, seeds, db);

// Use seed with type-safe attrs
const { user, posts } = await factory.seed('userWithPosts', { postCount: 5 });
```

## Objection.js Factory

### Builders

```typescript
import { ObjectionFactory } from '@geekmidas/testkit/objection';
import { Model } from 'objection';

class User extends Model {
  static tableName = 'users';
  id!: string;
  name!: string;
}

const builders = {
  user: ObjectionFactory.createBuilder(User, ({ attrs, faker }) => ({
    name: faker.person.fullName(),
    ...attrs,
  })),
};

const factory = new ObjectionFactory(builders, {}, knex);
const user = await factory.insert('user', { name: 'Jane Doe' });
```

### Seeds

```typescript
const seeds = {
  adminUser: ObjectionFactory.createSeed(
    async ({ attrs, factory }: {
      attrs: { name?: string };
      factory: ObjectionFactory<typeof builders, {}>;
      db: Knex;
    }) => {
      return factory.insert('user', {
        name: attrs.name || 'Admin User',
        role: 'admin',
      });
    }
  ),
};

const factory = new ObjectionFactory(builders, seeds, knex);
const admin = await factory.seed('adminUser', { name: 'Super Admin' });
```

## Transaction Isolation

Wrap tests with automatic transaction rollback:

```typescript
import { test } from 'vitest';
import { wrapVitestKyselyTransaction } from '@geekmidas/testkit/kysely';

const it = wrapVitestKyselyTransaction<Database>(test, {
  connection: () => db,
});

it('should create user', async ({ trx }) => {
  const user = await trx
    .insertInto('users')
    .values({ name: 'Test' })
    .returningAll()
    .executeTakeFirst();

  expect(user).toBeDefined();
  // Automatically rolled back after test
});
```

## Request Context

`@geekmidas/services` ships a `serviceContext` singleton backed by `AsyncLocalStorage`. Anything called inside `runWithRequestContext(...)` can read the active logger / request id / start time via `serviceContext.getLogger()`. In production, the construct adaptors (Hono, AWS, tRPC) set this up automatically; in tests, you have to establish the frame yourself or the first `serviceContext.*` call throws.

The `/request-context` entry exposes three helpers for this:

| Helper | Use it when |
|--------|-------------|
| `runInRequestContext(fn, opts?)` | You need a context for a single call — registering a service, exercising a unit of code that uses `serviceContext`. |
| `requestContextFixture(opts?)` | You're building a Vitest fixture and want every test in that `it` to run inside the ALS frame. Marked `auto: true`, so the test doesn't need to destructure it. |
| `withRequestContext(testApi, opts?)` | You already have a wrapped `TestAPI` (e.g. from `wrapVitestKyselyTransaction`) and want to layer a request context on top. |

All three accept `RequestContextOptions`: `logger`, `requestId`, `startTime`. Any field you omit gets a sensible default (`ConsoleLogger({ app: 'test' })`, `randomUUID()`, `Date.now()`).

### `runInRequestContext`

```typescript
import { runInRequestContext } from '@geekmidas/testkit/request-context';
import { ServiceDiscovery } from '@geekmidas/services';
import { DatabaseService } from '~/services/database';

test('registers services with a context', async () => {
  await runInRequestContext(async () => {
    const discovery = ServiceDiscovery.getInstance(envParser);
    // DatabaseService.register({ context }) can call context.getRequestId()
    // here because we're inside the ALS frame.
    const { database } = await discovery.register([DatabaseService]);
    expect(database).toBeDefined();
  }, { requestId: 'test-req-1' });
});
```

### `requestContextFixture`

Spread into `test.extend({ ... })` and every test runs inside the ALS frame, regardless of whether the test signature destructures `requestContext`.

```typescript
import { test } from 'vitest';
import { serviceContext } from '@geekmidas/services';
import { requestContextFixture } from '@geekmidas/testkit/request-context';

const it = test.extend({
  ...requestContextFixture({ requestId: 'fixture-req' }),
});

it('reads the active request id', () => {
  expect(serviceContext.getRequestId()).toBe('fixture-req');
});

it('also works without destructuring', ({ requestContext }) => {
  // The fixture is registered with `auto: true`, so it always runs.
  expect(requestContext.getRequestId()).toBe('fixture-req');
});
```

### `withRequestContext`

Compose on top of another wrapper. Useful with the Kysely transaction wrapper so each test runs inside both a transaction and a request context:

```typescript
import { test } from 'vitest';
import { wrapVitestKyselyTransaction } from '@geekmidas/testkit/kysely';
import { withRequestContext } from '@geekmidas/testkit/request-context';
import { serviceContext } from '@geekmidas/services';

const baseIt = wrapVitestKyselyTransaction<Database>(test, {
  connection: () => db,
});
const it = withRequestContext(baseIt, { requestId: 'wrapped-req' });

it('runs inside both a transaction and a request context', async ({ trx }) => {
  expect(serviceContext.getRequestId()).toBe('wrapped-req');

  const inserted = await trx
    .insertInto('users')
    .values({ name: 'Test' })
    .returningAll()
    .executeTakeFirst();

  expect(inserted).toBeDefined();
  // Transaction is rolled back after the test; the ALS frame is cleared.
});
```

### Why a fixture (not just `runInRequestContext`)?

Vitest fixtures suspend on `await use(value)` and run the test body from a continuation of the runner's async context — not from inside the fixture's call stack. A scoped `runWithRequestContext(data, () => use(value))` would end its frame the moment control returns to the runner, leaving the test body without context.

`requestContextFixture` and `withRequestContext` instead rely on `enterRequestContext` / `exitRequestContext` (exported from `@geekmidas/services`), which use `AsyncLocalStorage.enterWith` to mutate the current task's store. Async/await preserves that mutation across the suspension, so the test body sees the context. The fixture clears the frame in a `finally` block to keep tests isolated.

You generally won't need to call `enterRequestContext` / `exitRequestContext` directly — reach for `runInRequestContext` for one-offs and the fixture helpers for whole-test setup.

## Enhanced Faker

```typescript
import { faker } from '@geekmidas/testkit/faker';

// Timestamps for database records
const { createdAt, updatedAt } = faker.timestamps();

// Sequential numbers
faker.sequence();        // 1
faker.sequence();        // 2
faker.sequence('user');  // 1 (separate sequence)

// Prices and identifiers
faker.price();           // 29.99
faker.identifier();      // "com.example.widget1"

// Coordinates
const center = { lat: 40.7128, lng: -74.0060 };
faker.coordinates.within(center, 1000);  // Within 1km
```

## Better Auth Testing

In-memory adapter for testing [Better Auth](https://better-auth.com) without a real database:

```typescript
import { memoryAdapter } from '@geekmidas/testkit/better-auth';
import { betterAuth } from 'better-auth';

describe('Authentication', () => {
  const adapter = memoryAdapter({
    debugLogs: false,
    initialData: {
      user: [{ id: '1', email: 'test@example.com', name: 'Test User' }],
    },
  });

  const auth = betterAuth({
    database: adapter,
    // ... other config
  });

  afterEach(() => {
    adapter.clear(); // Reset data between tests
  });

  it('should create user', async () => {
    await auth.api.signUp({
      email: 'new@example.com',
      password: 'password123',
    });

    const data = adapter.getAllData();
    expect(data.user).toHaveLength(2);
  });
});
```

### Memory Adapter API

```typescript
function memoryAdapter(config?: {
  debugLogs?: boolean;      // Log operations to console
  usePlural?: boolean;      // Use plural table names
  initialData?: Record<string, any[]>;  // Pre-populate data
}): DatabaseAdapter & {
  clear(): void;            // Reset all data
  getAllData(): Record<string, any[]>;  // Get all stored data
  getStore(): Map<string, any>;  // Access underlying store
};
```