import type { FakerFactory } from './faker';

/**
 * Abstract base class for database factories used in testing.
 * Provides a standardized interface for creating test data using builder and seed patterns.
 * 
 * @template Builders - Record of builder functions for creating individual entities
 * @template Seeds - Record of seed functions for creating complex test scenarios
 * 
 * @example
 * ```typescript
 * // Define builders for creating individual records
 * const builders = {
 *   user: (attrs) => ({ name: 'Test User', email: 'test@example.com', ...attrs }),
 *   post: (attrs) => ({ title: 'Test Post', content: 'Content', ...attrs })
 * };
 * 
 * // Define seeds for complex scenarios
 * const seeds = {
 *   userWithPosts: async (attrs, factory) => {
 *     const user = await factory.insert('user', attrs);
 *     await factory.insertMany(3, 'post', { userId: user.id });
 *     return user;
 *   }
 * };
 * ```
 */
export abstract class Factory<
  Builders extends Record<string, any>,
  Seeds extends Record<string, any>,
> {
  /**
   * Creates a typed seed function with proper type inference.
   * This is a utility method to help with TypeScript type checking when defining seeds.
   * 
   * @template Seed - The seed function type
   * @param seedFn - The seed function to wrap
   * @returns The same seed function with proper typing
   * 
   * @example
   * ```typescript
   * const userWithPostsSeed = Factory.createSeed(async (attrs, factory, db) => {
   *   const user = await factory.insert('user', attrs);
   *   return user;
   * });
   * ```
   */
  static createSeed<Seed extends FactorySeed>(seedFn: Seed): Seed {
    return seedFn;
  }
  /**
   * Inserts an object into the database using a builder function.
   *
   * @param builderName - The name of the builder to use
   * @param attrs - The attributes to insert
   */
  abstract insert<K extends keyof Builders>(
    builderName: K,
    attrs?: Parameters<Builders[K]>[0],
  ): Promise<Awaited<ReturnType<Builders[K]>>>;

  /**
   * Inserts multiple objects into the database
   *
   * @param count -  Number of objects to insert
   * @param builderName - The name of the builder to use
   * @param attrs - The attributes to insert
   */
  abstract insertMany<K extends keyof Builders>(
    count: number,
    builderName: K,
    attrs?:
      | Parameters<Builders[K]>[0]
      | ((idx: number, faker: FakerFactory) => Parameters<Builders[K]>[0]),
  ): Promise<Awaited<ReturnType<Builders[K]>>[]>;

  /**
   * Seeds the database using a seed function.
   *
   * @param seedName - The name of the seed to use
   * @returns The result of the seed function
   * @param attrs - The attributes to pass to the seed function
   */
  abstract seed<K extends keyof Seeds>(
    seedName: K,
    attrs?: Parameters<Seeds[K]>[0],
  ): ReturnType<Seeds[K]>;
}

/**
 * Type definition for a factory builder function that can work with different database types.
 * Builders are responsible for creating individual database records with default values and relationships.
 * 
 * @template Attrs - The attributes/input type for the builder
 * @template Factory - The factory instance type
 * @template Result - The type of object returned by the builder
 * @template DB - The database connection type (Kysely, Knex, etc.)
 * 
 * @param attrs - Partial attributes to override defaults
 * @param factory - The factory instance for creating related records
 * @param db - The database connection
 * @returns The created record or a promise resolving to it
 * 
 * @example
 * ```typescript
 * const userBuilder: MixedFactoryBuilder<UserAttrs, Factory, User, Kysely<DB>> = 
 *   async (attrs, factory, db) => {
 *     return {
 *       id: faker.string.uuid(),
 *       name: faker.person.fullName(),
 *       email: faker.internet.email(),
 *       ...attrs
 *     };
 *   };
 * ```
 */
export type MixedFactoryBuilder<
  Attrs = any,
  Factory = any,
  Result = any,
  DB = any,
> = (attrs: Attrs, factory: Factory, db: DB) => Result | Promise<Result>;

/**
 * Type definition for a factory seed function used to create complex test scenarios.
 * Seeds typically create multiple related records to set up a complete test environment.
 * 
 * @template Attrs - The attributes/input type for the seed
 * @template Factory - The factory instance type
 * @template Result - The type of object returned by the seed
 * @template DB - The database connection type (Kysely, Knex, etc.)
 * 
 * @param attrs - Configuration attributes for the seed
 * @param factory - The factory instance for creating records
 * @param db - The database connection
 * @returns A promise resolving to the seed result
 * 
 * @example
 * ```typescript
 * const userWithPostsSeed: FactorySeed<{ postCount?: number }, Factory, User, DB> = 
 *   async (attrs, factory, db) => {
 *     const user = await factory.insert('user', attrs);
 *     const postCount = attrs.postCount || 3;
 *     
 *     for (let i = 0; i < postCount; i++) {
 *       await factory.insert('post', { userId: user.id });
 *     }
 *     
 *     return user;
 *   };
 * ```
 */
export type FactorySeed<Attrs = any, Factory = any, Result = any, DB = any> = (
  attrs: Attrs,
  factory: Factory,
  db: DB,
) => Promise<Result>;
