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
import { KyselyFactory } from '@geekmidas/testkit/kysely';
import { ObjectionFactory } from '@geekmidas/testkit/objection';
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
    (attrs, factory, db, faker) => ({
      id: faker.string.uuid(),
      name: faker.person.fullName(),
      email: faker.internet.email(),
      createdAt: new Date(),
      ...attrs,
    })
  ),
  post: KyselyFactory.createBuilder<Database, 'posts'>(
    'posts',
    (attrs, factory, db, faker) => ({
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

// Define your models
class User extends Model {
  static tableName = 'users';
  id!: number;
  name!: string;
  email!: string;
}

class Post extends Model {
  static tableName = 'posts';
  id!: number;
  title!: string;
  userId!: number;
}

// Create builders
const userBuilder = {
  table: 'users',
  model: User,
  defaults: async () => ({
    name: 'John Doe',
    email: `user${Date.now()}@example.com`,
  }),
};

// Use in tests
const factory = new ObjectionFactory({ user: userBuilder }, {});
const user = await factory.insert('user', { name: 'Jane Doe' });
```

## 🏗️ Core Concepts

### Builders

Builders define how to create test data for each table. They specify:

- **Table name**: The database table to insert into
- **Default values**: Function returning default attributes
- **Transformations**: Optional data transformations before insertion
- **Relations**: Optional related data to create after insertion

```typescript
const userBuilder = KyselyFactory.createBuilder<Database, 'users'>({
  table: 'users',
  defaults: async () => ({
    id: generateId(),
    name: faker.person.fullName(),
    email: faker.internet.email(),
    createdAt: new Date(),
  }),
  transform: async (data) => ({
    ...data,
    email: data.email.toLowerCase(),
  }),
  relations: async (user, factory) => {
    // Create related data after user insertion
    await factory.insert('profile', { userId: user.id });
  },
});
```

### Seeds

Seeds are functions that create complex test scenarios with multiple related entities:

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

### Transaction Support

TestKit supports transaction-based test isolation:

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
    // Test operations...
    // All changes will be rolled back after the test
  });
});
```

## 📚 Advanced Usage

### Database Migration

TestKit includes utilities for managing test database migrations:

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
  // Database is created and migrations are run
  
  // Store cleanup function for later
  globalThis.cleanupDb = cleanup;
});

afterAll(async () => {
  await globalThis.cleanupDb?.();
  // Database is dropped
});
```

### Custom Factories

You can extend the base Factory class for custom implementations:

```typescript
import { Factory } from '@geekmidas/testkit/factory';

class MongoFactory extends Factory {
  async performInsert(table: string, data: any) {
    const collection = this.db.collection(table);
    const result = await collection.insertOne(data);
    return { ...data, _id: result.insertedId };
  }

  async performInsertMany(table: string, data: any[]) {
    const collection = this.db.collection(table);
    const result = await collection.insertMany(data);
    return data.map((item, index) => ({
      ...item,
      _id: result.insertedIds[index],
    }));
  }
}
```

### Dynamic Attributes

Create dynamic attributes for each record in batch operations:

```typescript
const users = await factory.insertMany(10, 'user', (index) => ({
  name: `User ${index + 1}`,
  email: `user${index + 1}@example.com`,
  isAdmin: index === 0, // First user is admin
}));
```

### Conditional Auto-insertion

Control whether builders automatically insert data:

```typescript
const draftBuilder = KyselyFactory.createBuilder<Database, 'posts'>({
  table: 'posts',
  defaults: async () => ({
    title: 'Draft Post',
    status: 'draft',
  }),
  autoInsert: false, // Don't insert automatically
});

// Manually handle the data
const draftData = await draftBuilder.build();
// Perform validation or modifications...
const post = await db.insertInto('posts').values(draftData).execute();
```

## 🔧 API Reference

### KyselyFactory

```typescript
class KyselyFactory<TBuilders, TSeeds> extends Factory {
  constructor(
    builders: TBuilders,
    seeds: TSeeds,
    db: Kysely<any> | Transaction<any>
  );

  static createBuilder<TDatabase, TTable>(
    config: BuilderConfig<TDatabase, TTable>
  ): Builder;

  insert<K extends keyof TBuilders>(
    name: K,
    overrides?: Partial<BuilderOutput>
  ): Promise<BuilderOutput>;

  insertMany<K extends keyof TBuilders>(
    count: number,
    name: K,
    overrides?: Partial<BuilderOutput> | ((index: number) => Partial<BuilderOutput>)
  ): Promise<BuilderOutput[]>;

  seed<K extends keyof TSeeds>(
    name: K,
    ...args: Parameters<TSeeds[K]>
  ): Promise<ReturnType<TSeeds[K]>>;
}
```

### ObjectionFactory

```typescript
class ObjectionFactory<TBuilders, TSeeds> extends Factory {
  constructor(
    builders: TBuilders,
    seeds: TSeeds,
    knex?: Knex
  );

  // Same methods as KyselyFactory
}
```

### Builder Configuration

```typescript
interface BuilderConfig<TDatabase, TTable> {
  table: TTable;
  defaults: () => Promise<Insertable<TDatabase[TTable]>>;
  transform?: (data: any) => Promise<any>;
  relations?: (inserted: any, factory: Factory) => Promise<void>;
  autoInsert?: boolean;
}
```

## 🧪 Testing Best Practices

1. **Use Transactions**: Always wrap tests in transactions for isolation
2. **Create Minimal Data**: Only create the data necessary for each test
3. **Use Seeds for Complex Scenarios**: Encapsulate complex setups in seeds
4. **Leverage Type Safety**: Let TypeScript catch schema mismatches
5. **Clean Up Resources**: Always clean up database connections and transactions

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](../../CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../../LICENSE) file for details.