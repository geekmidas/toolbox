import type { FakerFactory } from './faker';

export abstract class Factory<
  Builders extends Record<string, any>,
  Seeds extends Record<string, any>,
> {
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

export type MixedFactoryBuilder<
  Attrs = any,
  Factory = any,
  Result = any,
  DB = any,
> = (attrs: Attrs, factory: Factory, db: DB) => Result | Promise<Result>;

export type FactorySeed<Attrs = any, Factory = any, Result = any, DB = any> = (
  attrs: Attrs,
  factory: Factory,
  db: DB,
) => Promise<Result>;
