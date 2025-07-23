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

## Kysely Factory

### Basic Usage

```typescript
import { KyselyFactory } from '@geekmidas/testkit/kysely';
import { db } from './database';

// Define builders
const builders = {
  user: (data) => ({
    id: data.id ?? randomUUID(),
    name: data.name ?? 'Test User',
    email: data.email ?? 'test@example.com',
    createdAt: data.createdAt ?? new Date(),
  }),
  post: (data) => ({
    id: data.id ?? randomUUID(),
    title: data.title ?? 'Test Post',
    content: data.content ?? 'Lorem ipsum',
    authorId: data.authorId,
    createdAt: data.createdAt ?? new Date(),
  }),
};

// Create factory
const factory = new KyselyFactory(builders, {}, db);

// Use in tests
describe('User API', () => {
  beforeEach(async () => {
    await factory.beginTransaction();
  });

  afterEach(async () => {
    await factory.rollbackTransaction();
  });

  it('should create user with posts', async () => {
    const user = await factory.insert('user', {
      name: 'John Doe',
    });

    const posts = await factory.insertMany('post', [
      { title: 'First Post', authorId: user.id },
      { title: 'Second Post', authorId: user.id },
    ]);

    expect(posts).toHaveLength(2);
  });
});
```

### Seed Functions

```typescript
const seeds = {
  userWithPosts: async (factory, data) => {
    const user = await factory.insert('user', data.user);
    const posts = await factory.insertMany('post', 
      data.posts.map(post => ({ ...post, authorId: user.id }))
    );
    return { user, posts };
  },
};

const factory = new KyselyFactory(builders, seeds, db);

// Use seed
const { user, posts } = await factory.seed('userWithPosts', {
  user: { name: 'Jane Doe' },
  posts: [{ title: 'Post 1' }, { title: 'Post 2' }],
});
```

## Objection.js Factory

```typescript
import { ObjectionFactory } from '@geekmidas/testkit/objection';
import { User, Post } from './models';

const factory = new ObjectionFactory({
  User: (data) => User.fromJson({
    name: data.name ?? 'Test User',
    email: data.email ?? 'test@example.com',
  }),
  Post: (data) => Post.fromJson({
    title: data.title ?? 'Test Post',
    content: data.content ?? 'Lorem ipsum',
  }),
});

// Use in tests
const user = await factory.create('User', {
  name: 'John Doe',
  posts: [
    { title: 'First Post' },
    { title: 'Second Post' },
  ],
});
```