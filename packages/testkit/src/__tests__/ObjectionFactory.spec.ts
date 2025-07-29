import type { Knex } from 'knex';
import { Model } from 'objection';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupKnexTest } from '../../test/helpers';
import { ObjectionFactory } from '../ObjectionFactory';
import { faker } from '../faker';

// Define real Objection models for testing
class User extends Model {
  static get tableName() {
    return 'users';
  }

  id!: number;
  name!: string;
  email!: string;
  role?: string;
  createdAt!: Date;
  updatedAt?: Date;
}

class Post extends Model {
  static get tableName() {
    return 'posts';
  }

  id!: number;
  title!: string;
  content!: string;
  userId!: number;
  published?: boolean;
  createdAt!: Date;
  updatedAt?: Date;
}

class Comment extends Model {
  static get tableName() {
    return 'comments';
  }

  id!: number;
  content!: string;
  postId!: number;
  userId!: number;
  createdAt!: Date;
}

describe.skip('ObjectionFactory', () => {
  let factory: ObjectionFactory<any, any>;
  let db: Knex;
  let trx: Knex.Transaction;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const setup = await setupKnexTest();
    db = setup.db;
    trx = setup.trx;
    cleanup = setup.cleanup;

    // Bind models to the transaction
    User.knex(trx);
    Post.knex(trx);
    Comment.knex(trx);
  });

  afterAll(async () => {
    await cleanup();
  });

  describe('constructor', () => {
    it('should create an ObjectionFactory instance', () => {
      const builders = {};
      const seeds = {};

      factory = new ObjectionFactory(builders, seeds, trx);

      expect(factory).toBeInstanceOf(ObjectionFactory);
    });
  });

  describe('insert method', () => {
    it('should call builder and insert the record', async () => {
      const userBuilder = async (attrs: any, factory: any, db: Knex) => {
        return User.fromJson({
          name: attrs.name || 'Default Name',
          email: attrs.email || `user${Date.now()}@example.com`,
          role: attrs.role || 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      };

      const builders = {
        user: userBuilder,
      };

      factory = new ObjectionFactory(builders, {}, trx);

      const attrs = { name: 'John Doe', email: 'john@example.com' };
      const result = await factory.insert('user', attrs);

      expect(result).toBeInstanceOf(User);
      expect(result.name).toBe('John Doe');
      expect(result.email).toBe('john@example.com');
      expect(result.id).toBeDefined();
    });

    it('should use empty object as default attributes', async () => {
      const userBuilder = async (attrs: any, factory: any, db: Knex) => {
        return User.fromJson({
          name: 'Default Name',
          email: `user${Date.now()}@example.com`,
          role: 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      };

      const builders = {
        user: userBuilder,
      };

      factory = new ObjectionFactory(builders, {}, trx);

      const result = await factory.insert('user');

      expect(result).toBeInstanceOf(User);
      expect(result.name).toBe('Default Name');
      expect(result.id).toBeDefined();
    });

    it('should throw error for non-existent factory', async () => {
      factory = new ObjectionFactory({}, {}, trx);

      await expect(factory.insert('nonExistent')).rejects.toThrow(
        'Factory "nonExistent" does not exist',
      );
    });

    it('should handle builder that returns a promise', async () => {
      const userBuilder = async (attrs: any, factory: any, db: Knex) => {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 10));
        return User.fromJson({
          name: attrs.name || 'Default Name',
          email: `async${Date.now()}@example.com`,
          role: 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      };

      const builders = {
        user: userBuilder,
      };

      factory = new ObjectionFactory(builders, {}, trx);

      const result = await factory.insert('user', { name: 'Jane' });

      expect(result).toBeInstanceOf(User);
      expect(result.name).toBe('Jane');
    });
  });

  describe('insertMany method', () => {
    it('should insert multiple records with same attributes', async () => {
      const userBuilder = async (attrs: any, factory: any, db: Knex) => {
        return User.fromJson({
          name: attrs.name || 'Default Name',
          email: `user${Date.now()}-${Math.random()}@example.com`,
          role: 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      };

      const builders = {
        user: userBuilder,
      };

      factory = new ObjectionFactory(builders, {}, trx);

      const attrs = { name: 'User' };
      const results = await factory.insertMany(3, 'user', attrs);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toBeInstanceOf(User);
        expect(result.name).toBe('User');
        expect(result.id).toBeDefined();
      });
    });

    it('should insert multiple records with dynamic attributes', async () => {
      const userBuilder = async (attrs: any, factory: any, db: Knex) => {
        return User.fromJson({
          name: attrs.name || 'Default Name',
          email: `user${Date.now()}-${Math.random()}@example.com`,
          role: 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      };

      const builders = {
        user: userBuilder,
      };

      factory = new ObjectionFactory(builders, {}, trx);

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

    it('should use empty object as default attributes for insertMany', async () => {
      const userBuilder = async (attrs: any, factory: any, db: Knex) => {
        return User.fromJson({
          name: 'Default Name',
          email: `user${Date.now()}-${Math.random()}@example.com`,
          role: 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      };

      const builders = {
        user: userBuilder,
      };

      factory = new ObjectionFactory(builders, {}, trx);

      const results = await factory.insertMany(2, 'user');

      expect(results).toHaveLength(2);
      results.forEach((result) => {
        expect(result).toBeInstanceOf(User);
        expect(result.name).toBe('Default Name');
        expect(result.id).toBeDefined();
      });
    });

    it('should throw error for non-existent builder in insertMany', async () => {
      factory = new ObjectionFactory({}, {}, trx);

      await expect(factory.insertMany(2, 'nonExistent')).rejects.toThrow(
        'Builder "nonExistent" is not registered',
      );
    });
  });

  describe('seed method', () => {
    it('should execute seed function', async () => {
      const userBuilder = async (attrs: any, factory: any, db: Knex) => {
        return User.fromJson({
          name: attrs.name || 'Default Name',
          email: attrs.email || `admin${Date.now()}@example.com`,
          role: 'admin',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      };

      const builders = { user: userBuilder };

      const createAdminSeed = async (attrs: any, factory: any, db: Knex) => {
        return await factory.insert('user', {
          name: attrs.name || 'Admin User',
          email: 'admin@example.com',
          role: 'admin',
        });
      };

      const seeds = {
        createAdmin: createAdminSeed,
      };

      factory = new ObjectionFactory(builders, seeds, trx);

      const attrs = { name: 'Super Admin' };
      const result = await factory.seed('createAdmin', attrs);

      expect(result).toBeInstanceOf(User);
      expect(result.name).toBe('Super Admin');
      expect(result.role).toBe('admin');
      expect(result.id).toBeDefined();
    });

    it('should use empty object as default attributes for seed', async () => {
      const userBuilder = async (attrs: any, factory: any, db: Knex) => {
        return User.fromJson({
          name: 'Default Admin',
          email: `admin${Date.now()}@example.com`,
          role: 'admin',
          createdAt: new Date(),
          updatedAt: new Date(),
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

      factory = new ObjectionFactory(builders, seeds, trx);

      const result = await factory.seed('createAdmin');

      expect(result).toBeInstanceOf(User);
      expect(result.name).toBe('Default Admin');
      expect(result.role).toBe('admin');
    });

    it('should throw error for non-existent seed', () => {
      factory = new ObjectionFactory({}, {}, trx);

      expect(() => factory.seed('nonExistent')).toThrow(
        'Seed "nonExistent" is not registered',
      );
    });

    it('should pass factory and db to seed function', async () => {
      const userBuilder = async (attrs: any, factory: any, db: Knex) => {
        return User.fromJson({
          name: attrs.name || 'Test User',
          email: `test${Date.now()}@example.com`,
          role: 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
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

      factory = new ObjectionFactory(builders, seeds, trx);

      const result = await factory.seed('complexSeed', { data: 'test' });

      expect(result).toBeInstanceOf(User);
      expect(result.name).toBe('Complex test');
    });
  });

  describe('createSeed static method', () => {
    it('should return the seed function unchanged', () => {
      const seedFn = async (attrs: any, factory: any, db: any) => {
        return { id: 1, name: 'test' };
      };

      const result = ObjectionFactory.createSeed(seedFn);

      expect(result).toBe(seedFn);
    });
  });

  describe('createBuilder static method', () => {
    it('should create a builder function with auto-insert', async () => {
      const userBuilder = ObjectionFactory.createBuilder(User, 
        (attrs, factory, db, faker) => ({
          name: faker.person.fullName(),
          email: faker.internet.email(),
          role: 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...attrs
        })
      );

      const builders = { user: userBuilder };
      factory = new ObjectionFactory(builders, {}, trx);

      const result = await factory.insert('user', { name: 'Test User' });

      expect(result).toBeInstanceOf(User);
      expect(result.name).toBe('Test User');
      expect(result.email).toMatch(/@/);
      expect(result.id).toBeDefined();
    });

    it('should create a builder function without auto-insert', async () => {
      const userBuilder = ObjectionFactory.createBuilder(User, 
        (attrs) => ({
          name: 'No Insert User',
          email: 'noinsert@example.com',
          role: 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...attrs
        }),
        false // Don't auto-insert
      );

      const builders = { user: userBuilder };
      factory = new ObjectionFactory(builders, {}, trx);

      const result = await factory.insert('user');

      // The factory's insert method should handle the insertion
      expect(result).toBeInstanceOf(User);
      expect(result.name).toBe('No Insert User');
      expect(result.id).toBeDefined();
    });

    it('should pass all parameters to the item function', async () => {
      let capturedFactory: any;
      let capturedDb: any;
      let capturedFaker: any;

      const userBuilder = ObjectionFactory.createBuilder(User,
        (attrs, factory, db, fakerInstance) => {
          capturedFactory = factory;
          capturedDb = db;
          capturedFaker = fakerInstance;
          
          return {
            name: 'Test User',
            email: 'test@example.com',
            role: 'user',
            createdAt: new Date(),
            updatedAt: new Date(),
            ...attrs
          };
        }
      );

      const builders = { user: userBuilder };
      factory = new ObjectionFactory(builders, {}, trx);

      await factory.insert('user');

      expect(capturedFactory).toBe(factory);
      expect(capturedDb).toBe(trx);
      expect(capturedFaker).toBe(faker);
    });

    it('should handle async item functions', async () => {
      const userBuilder = ObjectionFactory.createBuilder(User,
        async (attrs, factory, db, faker) => {
          // Simulate async operation
          await new Promise(resolve => setTimeout(resolve, 10));
          
          return {
            name: 'Async User',
            email: faker.internet.email(),
            role: 'user',
            createdAt: new Date(),
            updatedAt: new Date(),
            ...attrs
          };
        }
      );

      const builders = { user: userBuilder };
      factory = new ObjectionFactory(builders, {}, trx);

      const result = await factory.insert('user');

      expect(result).toBeInstanceOf(User);
      expect(result.name).toBe('Async User');
      expect(result.id).toBeDefined();
    });

    it('should work without item function', async () => {
      const userBuilder = ObjectionFactory.createBuilder(User);

      const builders = { user: userBuilder };
      factory = new ObjectionFactory(builders, {}, trx);

      const attrs = {
        name: 'Manual User',
        email: 'manual@example.com',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await factory.insert('user', attrs);

      expect(result).toBeInstanceOf(User);
      expect(result.name).toBe('Manual User');
      expect(result.email).toBe('manual@example.com');
      expect(result.id).toBeDefined();
    });

    it('should allow overriding default values', async () => {
      const userBuilder = ObjectionFactory.createBuilder(User,
        (attrs, factory, db, faker) => ({
          name: 'Default Name',
          email: 'default@example.com',
          role: 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...attrs
        })
      );

      const builders = { user: userBuilder };
      factory = new ObjectionFactory(builders, {}, trx);

      const result = await factory.insert('user', {
        name: 'Override Name',
        email: 'override@example.com'
      });

      expect(result).toBeInstanceOf(User);
      expect(result.name).toBe('Override Name');
      expect(result.email).toBe('override@example.com');
      expect(result.role).toBe('user'); // Default not overridden
    });
  });

  describe('error handling', () => {
    it('should handle builder errors gracefully', async () => {
      const userBuilder = async (attrs: any, factory: any, db: Knex) => {
        throw new Error('Builder failed');
      };

      const builders = {
        user: userBuilder,
      };

      factory = new ObjectionFactory(builders, {}, trx);

      await expect(factory.insert('user')).rejects.toThrow('Builder failed');
    });

    it('should handle invalid model data gracefully', async () => {
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

      factory = new ObjectionFactory(builders, {}, trx);

      await expect(factory.insert('user')).rejects.toThrow();
    });

    it('should handle seed function errors gracefully', async () => {
      const failingSeed = async (attrs: any, factory: any, db: Knex) => {
        throw new Error('Seed failed');
      };

      const seeds = {
        failingSeed,
      };

      factory = new ObjectionFactory({}, seeds, trx);

      await expect(factory.seed('failingSeed')).rejects.toThrow('Seed failed');
    });
  });

  describe('type safety and integration', () => {
    it('should work with typed builders and seeds', async () => {
      interface UserInterface {
        id: number;
        name: string;
        email: string;
      }

      type UserAttrs = Partial<Pick<UserInterface, 'name' | 'email'>>;

      const userBuilder = async (attrs: UserAttrs, factory: any, db: Knex) => {
        return User.fromJson({
          name: attrs.name || 'Default User',
          email: attrs.email || `user${Date.now()}@example.com`,
          role: 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      };

      const adminSeed = async (
        attrs: { isSuper?: boolean },
        factory: any,
        db: Knex,
      ) => {
        return factory.insert('user', {
          name: 'Admin',
          email: 'admin@example.com',
          role: 'admin',
        });
      };

      const builders = { user: userBuilder };
      const seeds = { admin: adminSeed };

      // This should compile without type errors
      factory = new ObjectionFactory(builders, seeds, trx);

      expect(factory).toBeInstanceOf(ObjectionFactory);

      // Test actual functionality
      const admin = await factory.seed('admin', { isSuper: true });
      expect(admin).toBeInstanceOf(User);
      expect(admin.name).toBe('Admin');
    });

    it('should handle complex builder scenarios', async () => {
      const userBuilder = async (attrs: any, factory: any, db: Knex) => {
        return User.fromJson({
          name: attrs.name || 'Default User',
          email: attrs.email || `user${Date.now()}@example.com`,
          role: 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      };

      const postBuilder = async (attrs: any, factory: any, db: Knex) => {
        // If no userId provided, create a user
        if (!attrs.userId) {
          const user = await factory.insert('user');
          return Post.fromJson({
            title: attrs.title || 'Default Post',
            content: attrs.content || 'Default content',
            userId: user.id,
            published: attrs.published || false,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        return Post.fromJson({
          title: attrs.title || 'Default Post',
          content: attrs.content || 'Default content',
          userId: attrs.userId,
          published: attrs.published || false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      };

      const builders = {
        user: userBuilder,
        post: postBuilder,
      };

      factory = new ObjectionFactory(builders, {}, trx);

      const post = await factory.insert('post', { title: 'Test Post' });

      expect(post).toBeInstanceOf(Post);
      expect(post.title).toBe('Test Post');
      expect(post.userId).toBeDefined();
      expect(typeof post.userId).toBe('number');
    });
  });
});
