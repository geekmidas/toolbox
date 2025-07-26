import type { Knex } from 'knex';
import { Factory, type FactorySeed } from './Factory.ts';

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
   * @param factory - The name of the builder to use
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
  insert(factory: keyof Builders, attrs: any = {}) {
    if (!(factory in this.builders)) {
      throw new Error(
        `Factory "${
          factory as string
        }" does not exist. Make sure it is correct and registered in src/test/setup.ts`,
      );
    }

    return this.builders[factory](attrs, {}, this.db).then((record: any) => {
      return record.$query(this.db).insertGraph(record).execute();
    }) as any;
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
  insertMany(count: number, builderName: keyof Builders, attrs: any = {}) {
    if (!(builderName in this.builders)) {
      throw new Error(
        `Builder "${
          builderName as string
        }" is not registered in this factory. Make sure it is correct and registered in src/test/setup.ts`,
      );
    }

    const records: any[] = [];
    for (let i = 0; i < count; i++) {
      const newAttrs = typeof attrs === 'function' ? (attrs as any)(i) : attrs;

      records.push(
        this.builders[builderName](newAttrs, {}, this.db).then((record: any) =>
          record.$query(this.db).insertGraph(record).execute(),
        ),
      );
    }

    return Promise.all(records);
  }
  /**
   * Executes a seed function to create complex test scenarios with multiple related records.
   * Seeds are useful for setting up complete test environments with realistic data relationships.
   *
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
  seed(seedName: keyof Seeds, attrs: any = {}) {
    if (!(seedName in this.seeds)) {
      throw new Error(
        `Seed "${
          seedName as string
        }" is not registered in this factory. Make sure it is correct and registered in src/test/setup.ts`,
      );
    }

    return this.seeds[seedName](attrs, this, this.db);
  }
}
