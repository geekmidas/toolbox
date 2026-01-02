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