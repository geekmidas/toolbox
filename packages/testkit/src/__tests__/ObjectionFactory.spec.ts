import type { Knex } from 'knex';
import { Model } from 'objection';
import { describe, expect, test } from 'vitest';
import { createKnexDb, createTestTablesKnex } from '../../test/helpers';
import { ObjectionFactory } from '../ObjectionFactory';
import { faker } from '../faker';
import { wrapVitestObjectionTransaction } from '../objection';

// Define simple Objection models for testing
class User extends Model {
  static get tableName() {
    return 'users';
  }

  id!: string;
  name!: string;
}

class Post extends Model {
  static get tableName() {
    return 'posts';
  }

  id!: string;
  title!: string;
  user_id!: string;
}

class Comment extends Model {
  static get tableName() {
    return 'comments';
  }

  id!: string;
  content!: string;
  post_id!: string;
  user_id!: string;
}

const it = wrapVitestObjectionTransaction(
  test,
  createKnexDb,
  createTestTablesKnex,
);
describe('ObjectionFactory', () => {
  it('should create an ObjectionFactory instance', ({ trx }) => {
    const builders = {};
    const seeds = {};

    const factory = new ObjectionFactory(builders, seeds, trx);

    expect(factory).toBeInstanceOf(ObjectionFactory);
  });

  it('should call builder and insert the record', async ({ trx }) => {
    const userBuilder = async (attrs: any, factory: any, db: Knex) => {
      return User.fromJson({
        name: attrs.name || 'Default Name',
      });
    };

    const builders = {
      user: userBuilder,
    };

    const factory = new ObjectionFactory(builders, {}, trx);

    const attrs = { name: 'John Doe', email: 'john@example.com' };
    const result = await factory.insert('user', attrs);

    expect(result).toBeInstanceOf(User);
    expect(result.name).toBe('John Doe');
    expect(result.id).toBeDefined();
  });

  it('should use empty object as default attributes', async ({ trx }) => {
    const userBuilder = async (attrs: any, factory: any, db: Knex) => {
      return User.fromJson({
        name: 'Default Name',
      });
    };

    const builders = {
      user: userBuilder,
    };

    const factory = new ObjectionFactory(builders, {}, trx);

    const result = await factory.insert('user');

    expect(result).toBeInstanceOf(User);
    expect(result.name).toBe('Default Name');
    expect(result.id).toBeDefined();
  });

  it('should throw error for non-existent factory', async ({ trx }) => {
    const factory = new ObjectionFactory({}, {}, trx);
    // @ts-ignore
    await expect(factory.insert('nonExistent')).rejects.toThrow(
      'Factory "nonExistent" does not exist',
    );
  });

  it('should handle builder that returns a promise', async ({ trx }) => {
    const userBuilder = async (attrs: any, factory: any, db: Knex) => {
      // Simulate async operation
      await new Promise((resolve) => setTimeout(resolve, 10));
      return User.fromJson({
        name: attrs.name || 'Default Name',
      });
    };

    const builders = {
      user: userBuilder,
    };

    const factory = new ObjectionFactory(builders, {}, trx);

    const result = await factory.insert('user', { name: 'Jane' });

    expect(result).toBeInstanceOf(User);
    expect(result.name).toBe('Jane');
  });

  it('should insert multiple records with same attributes', async ({ trx }) => {
    const userBuilder = async (attrs: any, factory: any, db: Knex) => {
      return User.fromJson({
        name: attrs.name || 'Default Name',
      });
    };

    const builders = {
      user: userBuilder,
    };

    const factory = new ObjectionFactory(builders, {}, trx);

    const attrs = { name: 'User' };
    const results = await factory.insertMany(3, 'user', attrs);

    expect(results).toHaveLength(3);
    results.forEach((result) => {
      expect(result).toBeInstanceOf(User);
      expect(result.name).toBe('User');
      expect(result.id).toBeDefined();
    });
  });

  it('should insert multiple records with dynamic attributes', async ({
    trx,
  }) => {
    const userBuilder = async (attrs: any, factory: any, db: Knex) => {
      return User.fromJson({
        name: attrs.name || 'Default Name',
      });
    };

    const builders = {
      user: userBuilder,
    };

    const factory = new ObjectionFactory(builders, {}, trx);

    const attrsFn = (idx: number) => ({ name: `User ${idx}` });
    const results = await factory.insertMany(2, 'user', attrsFn);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('User 0');
    expect(results[1].name).toBe('User 1');
    results.forEach((result) => {
      expect(result).toBeInstanceOf(User);
      expect(result.id).toBeDefined();
    });
  });

  it('should use empty object as default attributes for insertMany', async ({
    trx,
  }) => {
    const userBuilder = async (attrs: any, factory: any, db: Knex) => {
      return User.fromJson({
        name: 'Default Name',
      });
    };

    const builders = {
      user: userBuilder,
    };

    const factory = new ObjectionFactory(builders, {}, trx);

    const results = await factory.insertMany(2, 'user');

    expect(results).toHaveLength(2);
    results.forEach((result) => {
      expect(result).toBeInstanceOf(User);
      expect(result.name).toBe('Default Name');
      expect(result.id).toBeDefined();
    });
  });

  it('should throw error for non-existent builder in insertMany', async ({
    trx,
  }) => {
    const factory = new ObjectionFactory({}, {}, trx);
    // @ts-ignore
    await expect(factory.insertMany(2, 'nonExistent')).rejects.toThrow(
      'Builder "nonExistent" is not registered',
    );
  });

  it('should execute seed function', async ({ trx }) => {
    const userBuilder = async (attrs: any, factory: any, db: Knex) => {
      return User.fromJson({
        name: attrs.name || 'Default Name',
      });
    };

    const builders = { user: userBuilder };

    const createAdminSeed = async (attrs: any, factory: any, db: Knex) => {
      return await factory.insert('user', {
        name: attrs.name || 'Admin User',
      });
    };

    const seeds = {
      createAdmin: createAdminSeed,
    };

    const factory = new ObjectionFactory(builders, seeds, trx);

    const attrs = { name: 'Super Admin' };
    const result = await factory.seed('createAdmin', attrs);

    expect(result).toBeInstanceOf(User);
    expect(result.name).toBe('Super Admin');
    expect(result.id).toBeDefined();
  });

  it('should use empty object as default attributes for seed', async ({
    trx,
  }) => {
    const userBuilder = async (attrs: any, factory: any, db: Knex) => {
      return User.fromJson({
        name: 'Default Admin',
      });
    };

    const builders = { user: userBuilder };

    const createAdminSeed = async (attrs: any, factory: any, db: Knex) => {
      return await factory.insert('user', {
        name: 'Default Admin',
        role: 'admin',
      });
    };

    const seeds = {
      createAdmin: createAdminSeed,
    };

    const factory = new ObjectionFactory(builders, seeds, trx);

    const result = await factory.seed('createAdmin');

    expect(result).toBeInstanceOf(User);
    expect(result.name).toBe('Default Admin');
  });

  it('should throw error for non-existent seed', ({ trx }) => {
    const factory = new ObjectionFactory({}, {}, trx);
    // @ts-ignore
    expect(() => factory.seed('nonExistent')).toThrow(
      'Seed "nonExistent" is not registered',
    );
  });

  it('should pass factory and db to seed function', async ({ trx }) => {
    const userBuilder = async (attrs: any, factory: any, db: Knex) => {
      return User.fromJson({
        name: attrs.name || 'Test User',
      });
    };

    const builders = { user: userBuilder };

    const complexSeed = async (
      attrs: any,
      passedFactory: any,
      passedDb: Knex,
    ) => {
      // Verify that factory and db are passed correctly
      expect(passedFactory).toBe(factory);
      expect(passedDb).toBe(trx);

      return await passedFactory.insert('user', {
        name: `Complex ${attrs.data}`,
      });
    };

    const seeds = {
      complexSeed,
    };

    const factory = new ObjectionFactory(builders, seeds, trx);

    const result = await factory.seed('complexSeed', { data: 'test' });

    expect(result).toBeInstanceOf(User);
    expect(result.name).toBe('Complex test');
  });

  it('should return the seed function unchanged', () => {
    const seedFn = async (attrs: any, factory: any, db: any) => {
      return { id: 1, name: 'test' };
    };

    const result = ObjectionFactory.createSeed(seedFn);

    expect(result).toBe(seedFn);
  });

  it('should create a builder function with auto-insert', async ({ trx }) => {
    const userBuilder = ObjectionFactory.createBuilder(
      User,
      ({ attrs, faker }) => ({
        name: faker.person.fullName(),
        ...attrs,
      }),
    );

    const builders = { user: userBuilder };
    const factory = new ObjectionFactory(builders, {}, trx);

    const result = await factory.insert('user', { name: 'Test User' });

    expect(result).toBeInstanceOf(User);
    expect(result.name).toBe('Test User');
    expect(result.id).toBeDefined();
  });

  it('should create a builder function without auto-insert', async ({
    trx,
  }) => {
    const userBuilder = ObjectionFactory.createBuilder(
      User,
      ({ attrs }) => ({
        name: 'No Insert User',
        ...attrs,
      }),
      false, // Don't auto-insert
    );

    const builders = { user: userBuilder };
    const factory = new ObjectionFactory(builders, {}, trx);

    const result = await factory.insert('user');

    // The factory's insert method should handle the insertion
    expect(result).toBeInstanceOf(User);
    expect(result.name).toBe('No Insert User');
    expect(result.id).toBeDefined();
  });

  it('should pass all parameters to the item function', async ({ trx }) => {
    let capturedFactory: any;
    let capturedDb: any;
    let capturedFaker: any;

    const userBuilder = ObjectionFactory.createBuilder(
      User,
      ({ attrs, factory: passedFactory, db, faker: fakerInstance }) => {
        capturedFactory = passedFactory;
        capturedDb = db;
        capturedFaker = fakerInstance;

        return {
          name: 'Test User',
          ...attrs,
        };
      },
    );

    const builders = { user: userBuilder };
    const factory = new ObjectionFactory(builders, {}, trx);

    await factory.insert('user');

    expect(capturedFactory).toBe(factory);
    expect(capturedDb).toBe(trx);
    expect(capturedFaker).toBe(faker);
  });

  it('should handle async item functions', async ({ trx }) => {
    const userBuilder = ObjectionFactory.createBuilder(
      User,
      async ({ attrs }) => {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 10));

        return {
          name: 'Async User',
          ...attrs,
        };
      },
    );

    const builders = { user: userBuilder };
    const factory = new ObjectionFactory(builders, {}, trx);

    const result = await factory.insert('user');

    expect(result).toBeInstanceOf(User);
    expect(result.name).toBe('Async User');
    expect(result.id).toBeDefined();
  });

  it('should work without item function', async ({ trx }) => {
    const userBuilder = ObjectionFactory.createBuilder(User);

    const builders = { user: userBuilder };
    const factory = new ObjectionFactory(builders, {}, trx);

    const attrs = {
      name: 'Manual User',
    };

    const result = await factory.insert('user', attrs);

    expect(result).toBeInstanceOf(User);
    expect(result.name).toBe('Manual User');
    expect(result.id).toBeDefined();
  });

  it('should allow overriding default values', async ({ trx }) => {
    const userBuilder = ObjectionFactory.createBuilder(
      User,
      ({ attrs }) => ({
        name: 'Default Name',
        ...attrs,
      }),
    );

    const builders = { user: userBuilder };
    const factory = new ObjectionFactory(builders, {}, trx);

    const result = await factory.insert('user', {
      name: 'Override Name',
    });

    expect(result).toBeInstanceOf(User);
    expect(result.name).toBe('Override Name');
  });

  it('should handle builder errors gracefully', async ({ trx }) => {
    const userBuilder = async (attrs: any, factory: any, db: Knex) => {
      throw new Error('Builder failed');
    };

    const builders = {
      user: userBuilder,
    };

    const factory = new ObjectionFactory(builders, {}, trx);

    await expect(factory.insert('user')).rejects.toThrow('Builder failed');
  });

  it('should handle invalid model data gracefully', async ({ trx }) => {
    const userBuilder = async (attrs: any, factory: any, db: Knex) => {
      // Return invalid model data that will fail validation
      return User.fromJson({
        // Missing required fields
        invalidField: 'invalid',
      } as any);
    };

    const builders = {
      user: userBuilder,
    };

    const factory = new ObjectionFactory(builders, {}, trx);

    await expect(factory.insert('user')).rejects.toThrow();
  });

  it('should handle seed function errors gracefully', async ({ trx }) => {
    const failingSeed = async (attrs: any, factory: any, db: Knex) => {
      throw new Error('Seed failed');
    };

    const seeds = {
      failingSeed,
    };

    const factory = new ObjectionFactory({}, seeds, trx);

    await expect(factory.seed('failingSeed')).rejects.toThrow('Seed failed');
  });

  it('should work with typed builders and seeds', async ({ trx }) => {
    interface UserInterface {
      id: string;
      name: string;
    }

    type UserAttrs = Partial<Pick<UserInterface, 'name'>>;

    const userBuilder = async (attrs: UserAttrs, factory: any, db: Knex) => {
      return User.fromJson({
        name: attrs.name || 'Default User',
      });
    };

    const adminSeed = async (
      attrs: { isSuper?: boolean },
      factory: any,
      db: Knex,
    ) => {
      return factory.insert('user', {
        name: 'Admin',
      });
    };

    const builders = { user: userBuilder };
    const seeds = { admin: adminSeed };

    // This should compile without type errors
    const factory = new ObjectionFactory(builders, seeds, trx);

    expect(factory).toBeInstanceOf(ObjectionFactory);

    // Test actual functionality
    const admin = await factory.seed('admin', { isSuper: true });
    expect(admin).toBeInstanceOf(User);
    expect(admin.name).toBe('Admin');
  });

  it('should handle complex builder scenarios', async ({ trx }) => {
    const userBuilder = async (attrs: any, factory: any, db: Knex) => {
      return User.fromJson({
        name: attrs.name || 'Default User',
      });
    };

    const postBuilder = async (attrs: any, factory: any, db: Knex) => {
      // If no user_id provided, create a user
      if (!attrs.user_id) {
        const user = await factory.insert('user');
        return Post.fromJson({
          title: attrs.title || 'Default Post',
          user_id: user.id,
        });
      }
      return Post.fromJson({
        title: attrs.title || 'Default Post',
        user_id: attrs.user_id,
      });
    };

    const builders = {
      user: userBuilder,
      post: postBuilder,
    };

    const factory = new ObjectionFactory(builders, {}, trx);

    const post = await factory.insert('post', { title: 'Test Post' });

    expect(post).toBeInstanceOf(Post);
    expect(post.title).toBe('Test Post');
    expect(post.user_id).toBeDefined();
    expect(typeof post.user_id).toBe('string'); // PostgreSQL returns bigint as string
  });
});
