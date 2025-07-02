import type { Knex } from 'knex';
import { Factory, type FactorySeed } from './Factory.ts';

export class ObjectionFactory<
  Builders extends Record<string, any>,
  Seeds extends Record<string, any>,
> extends Factory<Builders, Seeds> {
  static createSeed<Seed extends FactorySeed>(seedFn: Seed): Seed {
    return Factory.createSeed(seedFn);
  }

  constructor(
    private builders: Builders,
    private seeds: Seeds,
    private db: Knex,
  ) {
    super();
  }

  insert(factory, attrs = {}) {
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
  insertMany(count, builderName, attrs = {}) {
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
  seed(seedName, attrs = {}) {
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
