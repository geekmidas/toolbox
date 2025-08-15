import type { Knex } from 'knex';
import type { Model } from 'objection';
import { Factory, type FactorySeed } from './Factory.ts';
import { type FakerFactory, faker } from './faker.ts';

/**
 * Factory implementation for Objection.js ORM, providing test data creation utilities.
 * Extends the base Factory class with Objection.js-specific database operations.
 *
 * @template Builders - Record of builder functions for creating entities
 * @template Seeds - Record of seed functions for complex test scenarios
 *
 * @example
 * ```typescript
 * // Define your models with Objection.js
 * class User extends Model {
 *   static tableName = 'users';
 * }
 *
 * // Create builders
 * const builders = {
 *   user: (attrs) => User.fromJson({
 *     id: faker.string.uuid(),
 *     name: faker.person.fullName(),
 *     email: faker.internet.email(),
 *     ...attrs
 *   }),
 *   post: (attrs) => Post.fromJson({
 *     title: 'Test Post',
 *     content: 'Test content',
 *     ...attrs
 *   })
 * };
 *
 * // Create factory instance
 * const factory = new ObjectionFactory(builders, seeds, knex);
 *
 * // Use in tests
 * const user = await factory.insert('user', { name: 'John Doe' });
 * ```
 */
export class ObjectionFactory<
  Builders extends Record<string, any>,
  Seeds extends Record<string, any>,
> extends Factory<Builders, Seeds> {
  /**
   * Creates a typed seed function with proper type inference.
   * Inherits from the base Factory class implementation.
   *
   * @template Seed - The seed function type
   * @param seedFn - The seed function to wrap
   * @returns The same seed function with proper typing
   */
  static createSeed<Seed extends FactorySeed>(seedFn: Seed): Seed {
    return Factory.createSeed(seedFn);
  }

  /**
   * Creates a typed builder function for Objection.js models.
   * This is a utility method that helps create builders with proper type inference.
   *
   * @template TModel - The Objection.js Model class type
   * @template Attrs - The attributes type for the builder (defaults to Partial of model)
   * @template Factory - The factory instance type
   * @template Result - The result type (defaults to the model instance)
   *
   * @param ModelClass - The Objection.js Model class
   * @param item - Optional function to provide default values and transformations
   * @param autoInsert - Whether to automatically insert the record (default: true)
   * @returns A builder function that creates and optionally inserts records
   *
   * @example
   * ```typescript
   * // Create a simple builder with defaults
   * const userBuilder = ObjectionFactory.createBuilder(User,
   *   (attrs, factory, db, faker) => ({
   *     id: faker.string.uuid(),
   *     name: faker.person.fullName(),
   *     email: faker.internet.email(),
   *     createdAt: new Date(),
   *     ...attrs
   *   })
   * );
   *
   * // Create a builder that doesn't auto-insert (useful for nested inserts)
   * const addressBuilder = ObjectionFactory.createBuilder(Address,
   *   (attrs) => ({
   *     street: '123 Main St',
   *     city: 'Anytown',
   *     ...attrs
   *   }),
   *   false // Don't auto-insert
   * );
   *
   * // Use with relations
   * const postBuilder = ObjectionFactory.createBuilder(Post,
   *   async (attrs, factory) => ({
   *     title: faker.lorem.sentence(),
   *     content: faker.lorem.paragraphs(),
   *     authorId: attrs.authorId || (await factory.insert('user')).id,
   *     ...attrs
   *   })
   * );
   * ```
   */
  static createBuilder<
    TModel extends typeof Model,
    Attrs extends Partial<InstanceType<TModel>> = Partial<InstanceType<TModel>>,
    Factory = any,
    Result = InstanceType<TModel>,
  >(
    ModelClass: TModel,
    item?: (
      attrs: Attrs,
      factory: Factory,
      db: Knex,
      faker: FakerFactory,
    ) => Partial<InstanceType<TModel>> | Promise<Partial<InstanceType<TModel>>>,
    autoInsert?: boolean,
  ): (
    attrs: Attrs,
    factory: Factory,
    db: Knex,
    faker: FakerFactory,
  ) => Promise<Result> {
    return async (
      attrs: Attrs,
      factory: Factory,
      db: Knex,
      faker: FakerFactory,
    ) => {
      // Start with attributes
      let data: Partial<InstanceType<TModel>> = { ...attrs };

      // Apply defaults
      if (item) {
        const defaults = await item(attrs, factory, db, faker);
        data = { ...defaults, ...data };
      }

      // Create model instance
      const model = ModelClass.fromJson(data) as InstanceType<TModel>;

      // Handle insertion based on autoInsert flag
      if (autoInsert !== false) {
        // Auto insert is enabled by default
        // Extract only defined values for insertion
        const insertData = Object.entries(model).reduce((acc, [key, value]) => {
          if (value !== undefined && key !== 'id') {
            acc[key] = value;
          }
          return acc;
        }, {} as any);
        
        // Use static query method to insert data directly
        // @ts-ignore
        const result = await ModelClass.query(db).insert(insertData);
        return result as Result;
      } else {
        // Return model for factory to handle insertion
        return model as Result;
      }
    };
  }

  /**
   * Creates a new ObjectionFactory instance.
   *
   * @param builders - Record of builder functions for creating individual entities
   * @param seeds - Record of seed functions for creating complex test scenarios
   * @param db - Knex database connection instance
   */
  constructor(
    private builders: Builders,
    private seeds: Seeds,
    private db: Knex,
  ) {
    super();
  }

  /**
   * Inserts a single record into the database using the specified builder.
   * Uses Objection.js's insertGraph method to handle nested relations.
   *
   * @template K - The builder name (must be a key of Builders)
   * @param builderName - The name of the builder to use
   * @param attrs - Optional attributes to override builder defaults
   * @returns A promise resolving to the inserted record with all relations
   * @throws Error if the specified builder doesn't exist
   *
   * @example
   * ```typescript
   * // Insert with defaults
   * const user = await factory.insert('user');
   *
   * // Insert with overrides
   * const adminUser = await factory.insert('user', {
   *   email: 'admin@example.com',
   *   role: 'admin'
   * });
   *
   * // Insert with nested relations
   * const userWithProfile = await factory.insert('user', {
   *   name: 'John Doe',
   *   profile: {
   *     bio: 'Software Developer',
   *     avatar: 'avatar.jpg'
   *   }
   * });
   * ```
   */
  async insert<K extends keyof Builders>(
    builderName: K,
    attrs?: Parameters<Builders[K]>[0],
  ): Promise<Awaited<ReturnType<Builders[K]>>> {
    if (!(builderName in this.builders)) {
      throw new Error(
        `Factory "${
          builderName as string
        }" does not exist. Make sure it is correct and registered in src/test/setup.ts`,
      );
    }

    const result = await this.builders[builderName](
      attrs || {},
      this,
      this.db,
      faker,
    );

    // If the builder returns a model instance, insert it
    if (result && typeof result.$query === 'function') {
      // Extract data from model, excluding undefined values and id
      const insertData = Object.entries(result).reduce((acc, [key, value]) => {
        if (value !== undefined && key !== 'id') {
          acc[key] = value;
        }
        return acc;
      }, {} as any);
      
      // Use the model's constructor to get the query builder
      return await result.constructor.query(this.db).insert(insertData);
    }

    // Otherwise, assume the builder handled insertion itself
    return result;
  }
  /**
   * Inserts multiple records into the database using the specified builder.
   * Supports both static attributes and dynamic attribute generation via a function.
   *
   * @param count - The number of records to insert
   * @param builderName - The name of the builder to use
   * @param attrs - Static attributes or a function that generates attributes for each record
   * @returns A promise resolving to an array of inserted records
   * @throws Error if the specified builder doesn't exist
   *
   * @example
   * ```typescript
   * // Insert multiple with same attributes
   * const users = await factory.insertMany(5, 'user', { role: 'member' });
   *
   * // Insert multiple with dynamic attributes
   * const posts = await factory.insertMany(10, 'post', (idx) => ({
   *   title: `Post ${idx + 1}`,
   *   content: `Content for post ${idx + 1}`,
   *   publishedAt: new Date()
   * }));
   *
   * // Create users with sequential emails
   * const admins = await factory.insertMany(3, 'user', (idx) => ({
   *   email: `admin${idx + 1}@example.com`,
   *   role: 'admin'
   * }));
   * ```
   */
  // Method overloads for better type inference
  async insertMany<K extends keyof Builders>(
    count: number,
    builderName: K,
    attrs?: Parameters<Builders[K]>[0],
  ): Promise<Awaited<ReturnType<Builders[K]>>[]>;
  async insertMany<K extends keyof Builders>(
    count: number,
    builderName: K,
    attrs: (idx: number, faker: FakerFactory) => Parameters<Builders[K]>[0],
  ): Promise<Awaited<ReturnType<Builders[K]>>[]>;
  async insertMany<K extends keyof Builders>(
    count: number,
    builderName: K,
    attrs?: any,
  ): Promise<Awaited<ReturnType<Builders[K]>>[]> {
    if (!(builderName in this.builders)) {
      throw new Error(
        `Builder "${
          builderName as string
        }" is not registered in this factory. Make sure it is correct and registered in src/test/setup.ts`,
      );
    }

    const records: any[] = [];
    for (let i = 0; i < count; i++) {
      const newAttrs =
        typeof attrs === 'function' ? await (attrs as any)(i, faker) : attrs;

      records.push(
        this.builders[builderName](newAttrs, this, this.db, faker).then(
          (record: any) => {
            // If the builder returns a model instance, insert it
            if (record && typeof record.$query === 'function') {
              // Extract data from model, excluding undefined values and id
              const insertData = Object.entries(record).reduce((acc, [key, value]) => {
                if (value !== undefined && key !== 'id') {
                  acc[key] = value;
                }
                return acc;
              }, {} as any);
              
              // Use the model's constructor to get the query builder
              return record.constructor.query(this.db).insert(insertData);
            }
            // Otherwise, assume the builder handled insertion itself
            return record;
          },
        ),
      );
    }

    return Promise.all(records);
  }
  /**
   * Executes a seed function to create complex test scenarios with multiple related records.
   * Seeds are useful for setting up complete test environments with realistic data relationships.
   *
   * @template K - The seed name (must be a key of Seeds)
   * @param seedName - The name of the seed to execute
   * @param attrs - Optional configuration attributes for the seed
   * @returns The result of the seed function (typically the primary record created)
   * @throws Error if the specified seed doesn't exist
   *
   * @example
   * ```typescript
   * // Execute a simple seed
   * const user = await factory.seed('userWithProfile');
   *
   * // Execute a seed with configuration
   * const author = await factory.seed('authorWithBooks', {
   *   bookCount: 5,
   *   includeReviews: true
   * });
   *
   * // Use seed result in tests with Objection.js relations
   * const company = await factory.seed('companyWithDepartments', {
   *   departmentCount: 3,
   *   employeesPerDepartment: 10
   * });
   *
   * // Access eager loaded relations
   * const companyWithRelations = await Company.query()
   *   .findById(company.id)
   *   .withGraphFetched('[departments.employees]');
   * ```
   */
  seed<K extends keyof Seeds>(
    seedName: K,
    attrs?: Parameters<Seeds[K]>[0],
  ): ReturnType<Seeds[K]> {
    if (!(seedName in this.seeds)) {
      throw new Error(
        `Seed "${
          seedName as string
        }" is not registered in this factory. Make sure it is correct and registered in src/test/setup.ts`,
      );
    }

    return this.seeds[seedName](attrs || {}, this, this.db);
  }
}
