# @geekmidas/testkit

> Type-safe testing utilities and database factories for modern TypeScript applications

[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.2-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## Overview

**@geekmidas/testkit** provides a comprehensive set of testing utilities designed to simplify database testing in TypeScript applications. It offers factory patterns for creating test data, supports multiple database libraries, and ensures type safety throughout your tests.

### Key Features

- **Factory Pattern**: Create test data with minimal boilerplate
- **Type Safety**: Full TypeScript support with automatic schema inference
- **Multi-Database Support**: Works with Kysely and Objection.js
- **Transaction Isolation**: Built-in support for test isolation
- **Enhanced Faker**: Extended faker with timestamps, sequences, and coordinates
- **AWS Mocks**: Mock Lambda contexts and API Gateway events
- **Better Auth**: In-memory adapter for authentication testing

## Installation

```bash
npm install --save-dev @geekmidas/testkit
# or
pnpm add -D @geekmidas/testkit
# or
yarn add -D @geekmidas/testkit
```

## Subpath Exports

```typescript
// Kysely utilities
import {
  KyselyFactory,
  wrapVitestKyselyTransaction,
  extendWithFixtures,
} from '@geekmidas/testkit/kysely';

// Objection.js utilities
import {
  ObjectionFactory,
  wrapVitestObjectionTransaction,
  extendWithFixtures,
} from '@geekmidas/testkit/objection';

// Other utilities
import { faker } from '@geekmidas/testkit/faker';
import { waitFor } from '@geekmidas/testkit/timer';
import { itWithDir } from '@geekmidas/testkit/os';
import { createMockContext, createMockV1Event, createMockV2Event } from '@geekmidas/testkit/aws';
import { createMockLogger } from '@geekmidas/testkit/logger';
import { memoryAdapter } from '@geekmidas/testkit/better-auth';
```

## Quick Start

### Database Factories with Kysely

```typescript
import { KyselyFactory } from '@geekmidas/testkit/kysely';
import { Kysely } from 'kysely';

// Define your database schema
interface Database {
  users: {
    id: string;
    name: string;
    email: string;
    createdAt: Date;
  };
  posts: {
    id: string;
    title: string;
    content: string;
    userId: string;
  };
}

// Create builders for your tables
const builders = {
  user: KyselyFactory.createBuilder<Database, 'users'>(
    'users',
    ({ attrs, faker }) => ({
      id: faker.string.uuid(),
      name: faker.person.fullName(),
      email: faker.internet.email(),
      createdAt: new Date(),
      ...attrs,
    })
  ),
  post: KyselyFactory.createBuilder<Database, 'posts'>(
    'posts',
    ({ attrs, faker }) => ({
      id: faker.string.uuid(),
      title: 'Test Post',
      content: faker.lorem.paragraph(),
      ...attrs,
    })
  ),
};

// Initialize factory
const factory = new KyselyFactory(builders, {}, db);

// Use in tests
describe('User Service', () => {
  it('should create a user with posts', async () => {
    const user = await factory.insert('user', {
      name: 'Jane Smith',
      email: 'jane@example.com',
    });

    const posts = await factory.insertMany(3, 'post', {
      userId: user.id,
    });

    expect(posts).toHaveLength(3);
    expect(posts[0].userId).toBe(user.id);
  });
});
```

### With Objection.js

```typescript
import { ObjectionFactory } from '@geekmidas/testkit/objection';
import { Model } from 'objection';

class User extends Model {
  static tableName = 'users';
  id!: string;
  name!: string;
  email!: string;
}

const builders = {
  user: ObjectionFactory.createBuilder(
    User,
    ({ attrs, faker }) => ({
      id: faker.string.uuid(),
      name: faker.person.fullName(),
      email: faker.internet.email(),
      ...attrs,
    })
  ),
};

const factory = new ObjectionFactory(builders, {}, knex);
const user = await factory.insert('user', { name: 'Jane Doe' });
```

## Enhanced Faker

The testkit provides an enhanced faker instance with additional utilities for common test data patterns.

```typescript
import { faker } from '@geekmidas/testkit/faker';

// Standard faker methods
const name = faker.person.fullName();
const email = faker.internet.email();

// Generate timestamps for database records
const { createdAt, updatedAt } = faker.timestamps();
// createdAt: Date in the past
// updatedAt: Date between createdAt and now

// Sequential numbers (useful for unique IDs)
faker.sequence();           // 1
faker.sequence();           // 2
faker.sequence('user');     // 1 (separate sequence)
faker.sequence('user');     // 2

// Reset sequences between tests
faker.resetSequence('user');
faker.resetAllSequences();

// Generate prices as numbers
const price = faker.price(); // 29.99

// Generate reverse domain identifiers
faker.identifier();         // "com.example.widget1"
faker.identifier('user');   // "org.acme.user"

// Generate coordinates within/outside a radius
const center = { lat: 40.7128, lng: -74.0060 };
faker.coordinates.within(center, 1000);   // Within 1km
faker.coordinates.outside(center, 1000, 5000); // Between 1km and 5km
```

## Timer Utilities

Simple async wait utility for tests.

```typescript
import { waitFor } from '@geekmidas/testkit/timer';

it('should process after delay', async () => {
  startBackgroundProcess();
  await waitFor(100); // Wait 100ms
  expect(processComplete).toBe(true);
});
```

## OS Utilities

Vitest fixture for temporary directory creation with automatic cleanup.

```typescript
import { itWithDir } from '@geekmidas/testkit/os';

// Creates a temp directory before test, removes it after
itWithDir('should write files to temp dir', async ({ dir }) => {
  const filePath = path.join(dir, 'test.txt');
  await fs.writeFile(filePath, 'hello');

  const content = await fs.readFile(filePath, 'utf-8');
  expect(content).toBe('hello');
  // Directory is automatically cleaned up after test
});
```

## AWS Testing Utilities

Mock AWS Lambda contexts and API Gateway events for testing Lambda handlers.

```typescript
import {
  createMockContext,
  createMockV1Event,
  createMockV2Event
} from '@geekmidas/testkit/aws';

describe('Lambda Handler', () => {
  it('should handle API Gateway v1 event', async () => {
    const event = createMockV1Event({
      httpMethod: 'POST',
      path: '/users',
      body: JSON.stringify({ name: 'John' }),
    });
    const context = createMockContext();

    const result = await handler(event, context);
    expect(result.statusCode).toBe(201);
  });

  it('should handle API Gateway v2 event', async () => {
    const event = createMockV2Event({
      routeKey: 'POST /users',
      rawPath: '/users',
      body: JSON.stringify({ name: 'John' }),
    });
    const context = createMockContext();

    const result = await handler(event, context);
    expect(result.statusCode).toBe(201);
  });
});
```

## Logger Testing Utilities

Create mock loggers for testing code that uses `@geekmidas/logger`.

```typescript
import { createMockLogger } from '@geekmidas/testkit/logger';

describe('Service', () => {
  it('should log errors', async () => {
    const logger = createMockLogger();
    const service = new MyService(logger);

    await service.doSomethingRisky();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      'Operation failed'
    );
  });
});
```

## Better Auth Testing

In-memory adapter for testing Better Auth without a real database.

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

## Database Migration

TestKit includes utilities for managing test database migrations.

```typescript
import { PostgresKyselyMigrator } from '@geekmidas/testkit/kysely';

const migrator = new PostgresKyselyMigrator({
  database: 'test_db',
  connection: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'password',
  },
  migrationFolder: './migrations',
});

// In test setup
beforeAll(async () => {
  const cleanup = await migrator.start();
  globalThis.cleanupDb = cleanup;
});

afterAll(async () => {
  await globalThis.cleanupDb?.();
});
```

## Vitest Transaction Isolation

TestKit provides Vitest-specific helpers for automatic transaction isolation. Each test runs in a transaction that is automatically rolled back after the test completes.

### Basic Usage

```typescript
import { test } from 'vitest';
import { wrapVitestKyselyTransaction } from '@geekmidas/testkit/kysely';
import { db } from './database';

// Wrap Vitest's test function with transaction support
const it = wrapVitestKyselyTransaction<Database>(
  test,
  () => db,
  async (trx) => {
    // Optional: Set up test tables or seed data
    await trx.schema.createTable('users').execute();
  }
);

// Each test gets its own transaction
it('should create user', async ({ trx }) => {
  const user = await trx
    .insertInto('users')
    .values({ name: 'John' })
    .returningAll()
    .executeTakeFirst();

  expect(user.name).toBe('John');
  // Transaction is automatically rolled back after test
});
```

### Extending with Fixtures

Use `extendWithFixtures` to add factory and other fixtures to your tests:

```typescript
import { test } from 'vitest';
import {
  wrapVitestKyselyTransaction,
  extendWithFixtures,
  KyselyFactory,
} from '@geekmidas/testkit/kysely';

// Define builders
const builders = {
  user: KyselyFactory.createBuilder<Database, 'users'>('users', ({ faker }) => ({
    name: faker.person.fullName(),
    email: faker.internet.email(),
  })),
  post: KyselyFactory.createBuilder<Database, 'posts'>('posts', ({ faker }) => ({
    title: faker.lorem.sentence(),
    content: faker.lorem.paragraphs(),
  })),
};

// Create base test with transaction
const baseTest = wrapVitestKyselyTransaction<Database>(test, () => db);

// Extend with factory fixture
const it = extendWithFixtures<
  Database,
  { factory: KyselyFactory<Database, typeof builders, {}> }
>(baseTest, {
  factory: (trx) => new KyselyFactory(builders, {}, trx),
});

// Both trx and factory are available in tests
it('should create user with factory', async ({ trx, factory }) => {
  const user = await factory.insert('user', { name: 'Jane' });

  expect(user.id).toBeDefined();
  expect(user.name).toBe('Jane');

  // Verify in database
  const found = await trx
    .selectFrom('users')
    .where('id', '=', user.id)
    .selectAll()
    .executeTakeFirst();

  expect(found?.name).toBe('Jane');
});

it('should create related records', async ({ factory }) => {
  const user = await factory.insert('user');
  const posts = await factory.insertMany(3, 'post', { userId: user.id });

  expect(posts).toHaveLength(3);
  expect(posts[0].userId).toBe(user.id);
});
```

### Multiple Fixtures

You can add multiple fixtures that all receive the transaction:

```typescript
const it = extendWithFixtures<
  Database,
  {
    factory: KyselyFactory<Database, typeof builders, {}>;
    userRepo: UserRepository;
    config: { maxUsers: number };
  }
>(baseTest, {
  factory: (trx) => new KyselyFactory(builders, {}, trx),
  userRepo: (trx) => new UserRepository(trx),
  config: () => ({ maxUsers: 100 }), // Fixtures can ignore trx if not needed
});

it('should use multiple fixtures', async ({ factory, userRepo, config }) => {
  const user = await factory.insert('user');
  const found = await userRepo.findById(user.id);
  expect(found).toBeDefined();
  expect(config.maxUsers).toBe(100);
});
```

### With Objection.js

```typescript
import { wrapVitestObjectionTransaction, extendWithFixtures } from '@geekmidas/testkit/objection';

const baseTest = wrapVitestObjectionTransaction(test, () => knex);

const it = extendWithFixtures<{ factory: ObjectionFactory<typeof builders, {}> }>(
  baseTest,
  {
    factory: (trx) => new ObjectionFactory(builders, {}, trx),
  }
);
```

## Manual Transaction Isolation

For more control, you can manage transactions manually:

```typescript
describe('User Service', () => {
  let trx: Transaction<Database>;
  let factory: KyselyFactory;

  beforeEach(async () => {
    trx = await db.transaction();
    factory = new KyselyFactory(builders, seeds, trx);
  });

  afterEach(async () => {
    await trx.rollback();
  });

  it('should perform operations in isolation', async () => {
    const user = await factory.insert('user');
    // All changes will be rolled back after the test
  });
});
```

## Seeds

Seeds are functions that create complex test scenarios:

```typescript
const blogSeed = async (factory: Factory) => {
  const author = await factory.insert('user', {
    name: 'Blog Author',
    role: 'author',
  });

  const categories = await factory.insertMany(3, 'category');

  const posts = await factory.insertMany(5, 'post', (index) => ({
    title: `Post ${index + 1}`,
    authorId: author.id,
    categoryId: categories[index % categories.length].id,
  }));

  return { author, categories, posts };
};

// Use in tests
const data = await factory.seed('blog');
```

## API Reference

### KyselyFactory

```typescript
class KyselyFactory<DB, Builders, Seeds> {
  constructor(
    builders: Builders,
    seeds: Seeds,
    db: Kysely<DB> | ControlledTransaction<DB>
  );

  static createBuilder<DB, TableName extends keyof DB & string>(
    table: TableName,
    defaults?: (context: {
      attrs: Partial<Insertable<DB[TableName]>>;
      factory: KyselyFactory;
      db: Kysely<DB>;
      faker: FakerFactory;
    }) => Partial<Insertable<DB[TableName]>> | Promise<...>,
    autoInsert?: boolean
  ): BuilderFunction;

  insert<K extends keyof Builders>(
    builderName: K,
    attrs?: Partial<BuilderAttrs>
  ): Promise<BuilderResult>;

  insertMany<K extends keyof Builders>(
    count: number,
    builderName: K,
    attrs?: Partial<BuilderAttrs> | ((idx: number, faker: FakerFactory) => Partial<BuilderAttrs>)
  ): Promise<BuilderResult[]>;

  seed<K extends keyof Seeds>(
    seedName: K,
    attrs?: SeedAttrs
  ): Promise<SeedResult>;
}
```

### Enhanced Faker

```typescript
interface EnhancedFaker extends Faker {
  timestamps(): { createdAt: Date; updatedAt: Date };
  sequence(name?: string): number;
  resetSequence(name?: string, value?: number): void;
  resetAllSequences(): void;
  identifier(suffix?: string): string;
  price(): number;
  coordinates: {
    within(center: Coordinate, radiusMeters: number): Coordinate;
    outside(center: Coordinate, minRadius: number, maxRadius: number): Coordinate;
  };
}
```

### AWS Mocks

```typescript
function createMockContext(): Context;
function createMockV1Event(overrides?: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent;
function createMockV2Event(overrides?: Partial<APIGatewayProxyEventV2>): APIGatewayProxyEventV2;
```

### Memory Adapter (Better Auth)

```typescript
function memoryAdapter(config?: {
  debugLogs?: boolean;
  usePlural?: boolean;
  initialData?: Record<string, any[]>;
}): DatabaseAdapter & {
  clear(): void;
  getAllData(): Record<string, any[]>;
  getStore(): Map<string, any>;
};
```

## Testing Best Practices

1. **Use Transactions**: Always wrap tests in transactions for isolation
2. **Create Minimal Data**: Only create the data necessary for each test
3. **Use Seeds for Complex Scenarios**: Encapsulate complex setups in seeds
4. **Leverage Type Safety**: Let TypeScript catch schema mismatches
5. **Clean Up Resources**: Always clean up database connections and transactions
6. **Reset Sequences**: Call `faker.resetAllSequences()` in `beforeEach` for predictable IDs

## Contributing

We welcome contributions! Please see our [Contributing Guide](../../CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](../../LICENSE) file for details.
