import { beforeEach, describe, expect, it } from 'vitest';
import { faker } from '../faker';

describe('faker', () => {
  describe('sequence', () => {
    beforeEach(() => {
      faker.resetAllSequences();
    });

    it('should start from 1 for a new sequence', () => {
      expect(faker.sequence()).toBe(1);
      expect(faker.sequence('custom')).toBe(1);
    });

    it('should increment on each call', () => {
      expect(faker.sequence()).toBe(1);
      expect(faker.sequence()).toBe(2);
      expect(faker.sequence()).toBe(3);
    });

    it('should maintain separate counters for different names', () => {
      expect(faker.sequence('users')).toBe(1);
      expect(faker.sequence('posts')).toBe(1);
      expect(faker.sequence('users')).toBe(2);
      expect(faker.sequence('posts')).toBe(2);
      expect(faker.sequence('users')).toBe(3);
      expect(faker.sequence('posts')).toBe(3);
    });

    it('should handle concurrent-like sequential calls', () => {
      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(faker.sequence('concurrent'));
      }

      // Check that all values are unique and sequential
      expect(results).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    });
  });

  describe('resetSequence', () => {
    beforeEach(() => {
      faker.resetAllSequences();
    });

    it('should reset a specific sequence to 0', () => {
      faker.sequence('test');
      faker.sequence('test');
      expect(faker.sequence('test')).toBe(3);

      faker.resetSequence('test');
      expect(faker.sequence('test')).toBe(1);
    });

    it('should reset a specific sequence to a custom value', () => {
      faker.sequence('test');
      faker.resetSequence('test', 10);
      expect(faker.sequence('test')).toBe(11);
    });

    it('should create a new sequence if it does not exist', () => {
      faker.resetSequence('new', 5);
      expect(faker.sequence('new')).toBe(6);
    });

    it('should not affect other sequences', () => {
      faker.sequence('test1');
      faker.sequence('test1');
      faker.sequence('test2');

      faker.resetSequence('test1');

      expect(faker.sequence('test1')).toBe(1);
      expect(faker.sequence('test2')).toBe(2);
    });
  });

  describe('resetAllSequences', () => {
    it('should reset all sequences', () => {
      faker.sequence('test1');
      faker.sequence('test1');
      faker.sequence('test2');
      faker.sequence('test2');
      faker.sequence('test2');

      faker.resetAllSequences();

      expect(faker.sequence('test1')).toBe(1);
      expect(faker.sequence('test2')).toBe(1);
      expect(faker.sequence()).toBe(1);
    });
  });

  describe('identifier', () => {
    beforeEach(() => {
      faker.resetAllSequences();
    });

    it('should include sequence number in identifier', () => {
      const id1 = faker.identifier();
      const id2 = faker.identifier();

      // Both should be different because of the sequence
      expect(id1).not.toBe(id2);

      // Should end with sequence numbers
      expect(id1).toMatch(/1$/);
      expect(id2).toMatch(/2$/);
    });

    it('should use custom suffix when provided', () => {
      const id = faker.identifier('customSuffix');
      expect(id).toMatch(/\.customSuffix$/);
    });
  });

  describe('timestamps', () => {
    it('should return createdAt and updatedAt dates', () => {
      const { createdAt, updatedAt } = faker.timestamps();

      expect(createdAt).toBeInstanceOf(Date);
      expect(updatedAt).toBeInstanceOf(Date);
      expect(createdAt.getTime()).toBeLessThanOrEqual(updatedAt.getTime());
      expect(updatedAt.getTime()).toBeLessThanOrEqual(new Date().getTime());
    });

    it('should have milliseconds set to 0', () => {
      const { createdAt, updatedAt } = faker.timestamps();

      expect(createdAt.getMilliseconds()).toBe(0);
      expect(updatedAt.getMilliseconds()).toBe(0);
    });
  });

  describe('price', () => {
    it('should return a number', () => {
      const result = faker.price();
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });
  });
});
