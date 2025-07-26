import type {
  ControlledTransaction,
  Insertable,
  Kysely,
  Selectable,
} from 'kysely';
import { Factory, type FactorySeed } from './Factory.ts';
import { type FakerFactory, faker } from './faker.ts';

/**
 * Factory implementation for Kysely ORM, providing test data creation utilities.
 * Extends the base Factory class with Kysely-specific database operations.
 *
 * @template DB - The database schema type
 * @template Builders - Record of builder functions for creating entities
 * @template Seeds - Record of seed functions for complex test scenarios
 *
 * @example
 * ```typescript
 * // Define your database schema
 * interface Database {
 *   users: UsersTable;
 *   posts: PostsTable;
 * }
 *
 * // Create builders
 * const builders = {
 *   user: KyselyFactory.createBuilder<Database, 'users'>('users', (attrs, factory, db, faker) => ({
 *     id: faker.string.uuid(),
 *     name: faker.person.fullName(),
 *     email: faker.internet.email(),
 *     ...attrs
 *   })),
 *   post: KyselyFactory.createBuilder<Database, 'posts'>('posts', (attrs) => ({
 *     title: 'Test Post',
 *     content: 'Test content',
 *     ...attrs
 *   }))
 * };
 *
 * // Create factory instance
 * const factory = new KyselyFactory(builders, seeds, db);
 *
 * // Use in tests
 * const user = await factory.insert('user', { name: 'John Doe' });
 * ```
 */
export class KyselyFactory<
  DB,
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
   * Creates a new KyselyFactory instance.
   *
   * @param builders - Record of builder functions for creating individual entities
   * @param seeds - Record of seed functions for creating complex test scenarios
   * @param db - Kysely database instance or controlled transaction
   */
  constructor(
    private builders: Builders,
    private seeds: Seeds,
    private db: Kysely<DB> | ControlledTransaction<DB, []>,
  ) {
    super();
  }

  /**
   * Creates a typed builder function for a specific database table.
   * This is a utility method that helps create builders with proper type inference for Kysely.
   *
   * @template DB - The database schema type
   * @template TableName - The name of the table (must be a key of DB)
   * @template Attrs - The attributes type for the builder (defaults to Partial<Insertable>)
   * @template Factory - The factory instance type
   * @template Result - The result type (defaults to Selectable of the table)
   *
   * @param table - The name of the database table
   * @param item - Optional function to provide default values and transformations
   * @param autoInsert - Whether to automatically insert the record (default: true)
   * @returns A builder function that creates and optionally inserts records
   *
   * @example
   * ```typescript
   * // Create a simple builder with defaults
   * const userBuilder = KyselyFactory.createBuilder<DB, 'users'>('users',
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
   * const addressBuilder = KyselyFactory.createBuilder<DB, 'addresses'>('addresses',
   *   (attrs) => ({
   *     street: '123 Main St',
   *     city: 'Anytown',
   *     ...attrs
   *   }),
   *   false // Don't auto-insert
   * );
   * ```
   */
  static createBuilder<
    DB,
    TableName extends keyof DB & string,
    Attrs extends Partial<Insertable<DB[TableName]>> = Partial<
      Insertable<DB[TableName]>
    >,
    Factory = any,
    Result = Selectable<DB[TableName]>,
  >(
    table: TableName,
    item?: (
      attrs: Attrs,
      factory: Factory,
      db: Kysely<DB>,
      faker: FakerFactory,
    ) =>
      | Partial<Insertable<DB[TableName]>>
      | Promise<Partial<Insertable<DB[TableName]>>>,
    autoInsert?: boolean,
  ): (
    attrs: Attrs,
    factory: Factory,
    db: Kysely<DB>,
    faker: FakerFactory,
  ) => Promise<Result> {
    return async (
      attrs: Attrs,
      factory: Factory,
      db: Kysely<DB>,
      faker: FakerFactory,
    ) => {
      // Start with attributes
      let data: Partial<Insertable<DB[TableName]>> = { ...attrs };

      // Apply defaults
      if (item) {
        const defaults = await item(attrs, factory, db, faker);
        data = { ...defaults, ...data };
      }

      // Handle insertion based on autoInsert flag
      if (autoInsert !== false) {
        // Auto insert is enabled by default
        const result = await db
          .insertInto(table)
          .values(data as Insertable<DB[TableName]>)
          .returningAll()
          .executeTakeFirst();

        if (!result) {
          throw new Error(`Failed to insert into ${table}`);
        }

        return result as Result;
      } else {
        // Return object for factory to handle insertion
        return { table, data } as any;
      }
    };
  }

  /**
   * Inserts a single record into the database using the specified builder.
   * The builder function is responsible for generating the record data with defaults
   * and the factory handles the actual database insertion.
   *
   * @template K - The builder name (must be a key of Builders)
   * @param builderName - The name of the builder to use
   * @param attrs - Optional attributes to override builder defaults
   * @returns A promise resolving to the inserted record
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
   * // Use the inserted record
   * const post = await factory.insert('post', {
   *   userId: user.id,
   *   title: 'My First Post'
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

    // For Kysely, we expect the builder to return an object with table and data properties
    // or to handle the insertion itself and return the inserted record
    if (
      result &&
      typeof result === 'object' &&
      'table' in result &&
      'data' in result
    ) {
      // If the builder returns {table: string, data: object}, we insert it
      const inserted = await this.db
        .insertInto(result.table)
        .values(result.data)
        .returningAll()
        .executeTakeFirst();

      return inserted as any;
    }

    // Otherwise, assume the builder handled the insertion itself
    return result;
  }

  /**
   * Inserts multiple records into the database using the specified builder.
   * Supports both static attributes and dynamic attribute generation via a function.
   *
   * @template K - The builder name (must be a key of Builders)
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
   * const posts = await factory.insertMany(10, 'post', (idx, faker) => ({
   *   title: `Post ${idx + 1}`,
   *   content: faker.lorem.paragraph(),
   *   publishedAt: faker.date.past()
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

    const promises: Promise<any>[] = [];

    for (let i = 0; i < count; i++) {
      const newAttrs = typeof attrs === 'function' ? attrs(i, faker) : attrs;
      promises.push(this.insert(builderName, newAttrs));
    }

    return Promise.all(promises);
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
   * // Use seed result in tests
   * const company = await factory.seed('companyWithDepartments', {
   *   departmentCount: 3,
   *   employeesPerDepartment: 10
   * });
   * expect(company.departments).toHaveLength(3);
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
