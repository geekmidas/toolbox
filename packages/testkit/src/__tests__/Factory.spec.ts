import { beforeEach, describe, expect, it } from 'vitest';
import {
  Factory,
  type FactorySeed,
  type MixedFactoryBuilder,
} from '../Factory';

// Create a concrete implementation for testing
class TestFactory extends Factory<
  { testBuilder: (attrs: any) => any },
  { testSeed: (attrs: any, factory: any, db: any) => any }
> {
  async insert(builderName: any, attrs?: any) {
    return Promise.resolve({ id: 1, ...attrs });
  }

  async insertMany(count: number, builderName: any, attrs?: any) {
    const results: any[] = [];
    for (let i = 0; i < count; i++) {
      const newAttrs = typeof attrs === 'function' ? attrs(i) : attrs;
      results.push(await this.insert(builderName, newAttrs));
    }
    return results;
  }

  seed(seedName: any, attrs?: any): any {
    return Promise.resolve({ seedResult: true, ...attrs });
  }
}

describe('Factory', () => {
  describe('abstract class functionality', () => {
    it('should be instantiable through concrete implementation', () => {
      const factory = new TestFactory();
      expect(factory).toBeInstanceOf(Factory);
      expect(factory).toBeInstanceOf(TestFactory);
    });

    it('should have abstract methods defined', () => {
      const factory = new TestFactory();
      expect(typeof factory.insert).toBe('function');
      expect(typeof factory.insertMany).toBe('function');
      expect(typeof factory.seed).toBe('function');
    });
  });

  describe('createSeed static method', () => {
    it('should return the seed function unchanged', () => {
      const seedFn = async ({ attrs, factory, db }: { attrs: any; factory: any; db: any }) => {
        return { id: 1, name: 'test' };
      };

      const result = Factory.createSeed(seedFn);

      expect(result).toBe(seedFn);
      expect(typeof result).toBe('function');
    });

    it('should work with different seed function signatures', () => {
      const simpleSeed = async () => ({ simple: true });
      const complexSeed = async ({
        attrs,
      }: {
        attrs: { name: string };
        factory: any;
        db: any;
      }) => {
        return { name: attrs.name, created: true };
      };

      const result1 = Factory.createSeed(simpleSeed);
      const result2 = Factory.createSeed(complexSeed);

      expect(result1).toBe(simpleSeed);
      expect(result2).toBe(complexSeed);
    });
  });

  describe('concrete implementation behavior', () => {
    let factory: TestFactory;

    beforeEach(() => {
      factory = new TestFactory();
    });

    it('should implement insert method', async () => {
      const result = await factory.insert('testBuilder', { name: 'test' });
      expect(result).toEqual({ id: 1, name: 'test' });
    });

    it('should implement insertMany method', async () => {
      const results = await factory.insertMany(3, 'testBuilder', {
        name: 'test',
      });
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ id: 1, name: 'test' });
    });

    it('should implement insertMany with function attributes', async () => {
      const results = await factory.insertMany(2, 'testBuilder', (idx) => ({
        name: `test${idx}`,
      }));
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ id: 1, name: 'test0' });
      expect(results[1]).toEqual({ id: 1, name: 'test1' });
    });

    it('should implement seed method', async () => {
      const result = await factory.seed('testSeed', { custom: 'value' });
      expect(result).toEqual({ seedResult: true, custom: 'value' });
    });
  });

  describe('type definitions', () => {
    it('should properly type MixedFactoryBuilder', () => {
      // Test that the type allows both sync and async returns
      const syncBuilder: MixedFactoryBuilder = (attrs, factory, db) => ({
        sync: true,
      });
      const asyncBuilder: MixedFactoryBuilder = async (attrs, factory, db) => ({
        async: true,
      });

      expect(typeof syncBuilder).toBe('function');
      expect(typeof asyncBuilder).toBe('function');
    });

    it('should properly type FactorySeed', () => {
      // Test that FactorySeed requires async return with object parameter
      const seed: FactorySeed = async ({ attrs, factory, db }) => ({
        seeded: true,
      });

      expect(typeof seed).toBe('function');
    });
  });
});

// Test the type exports
describe('Factory types', () => {
  it('should export MixedFactoryBuilder type', () => {
    const builder: MixedFactoryBuilder<
      { name: string },
      TestFactory,
      { id: number; name: string },
      any
    > = (attrs, factory, db) => {
      return { id: 1, name: attrs.name };
    };

    expect(typeof builder).toBe('function');
  });

  it('should export FactorySeed type', () => {
    const seed: FactorySeed<
      { count: number },
      TestFactory,
      { created: number },
      any
    > = async ({ attrs }) => {
      return { created: attrs.count };
    };

    expect(typeof seed).toBe('function');
  });
});
