import type {
  ControlledTransaction,
  Insertable,
  Kysely,
  Selectable,
} from 'kysely';
import { Factory, type FactorySeed } from './Factory.ts';
import { type FakerFactory, faker } from './faker.ts';

export class KyselyFactory<
  DB,
  Builders extends Record<string, any>,
  Seeds extends Record<string, any>,
> extends Factory<Builders, Seeds> {
  static createSeed<Seed extends FactorySeed>(seedFn: Seed): Seed {
    return Factory.createSeed(seedFn);
  }

  constructor(
    private builders: Builders,
    private seeds: Seeds,
    private db: Kysely<DB> | ControlledTransaction<DB, []>,
  ) {
    super();
  }

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
