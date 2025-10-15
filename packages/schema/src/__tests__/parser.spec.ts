import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { parseSchema, validate } from '../parser';

describe('Schema Parser', () => {
  describe('validate', () => {
    it('should validate data against a Zod schema', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const result = await validate(schema, { name: 'John', age: 30 });

      expect(result.issues).toBeUndefined();
      if ('value' in result) {
        expect(result.value).toEqual({ name: 'John', age: 30 });
      }
    });

    it('should return issues for invalid data', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const result = await validate(schema, { name: 'John', age: 'invalid' });

      expect(result.issues).toBeDefined();
    });

    it('should validate string schema', async () => {
      const schema = z.string();

      const result = await validate(schema, 'test string');

      expect(result.issues).toBeUndefined();
      if ('value' in result) {
        expect(result.value).toBe('test string');
      }
    });

    it('should validate array schema', async () => {
      const schema = z.array(z.number());

      const result = await validate(schema, [1, 2, 3]);

      expect(result.issues).toBeUndefined();
      if ('value' in result) {
        expect(result.value).toEqual([1, 2, 3]);
      }
    });

    it('should return issues for invalid array items', async () => {
      const schema = z.array(z.number());

      const result = await validate(schema, [1, 'invalid', 3]);

      expect(result.issues).toBeDefined();
    });

    it('should validate nested objects', async () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          profile: z.object({
            bio: z.string(),
          }),
        }),
      });

      const result = await validate(schema, {
        user: {
          name: 'John',
          profile: { bio: 'Developer' },
        },
      });

      expect(result.issues).toBeUndefined();
      if ('value' in result) {
        expect(result.value).toEqual({
          user: {
            name: 'John',
            profile: { bio: 'Developer' },
          },
        });
      }
    });
  });

  describe('parseSchema', () => {
    it('should parse valid data', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const result = await parseSchema(schema, { name: 'John', age: 30 });

      expect(result).toEqual({ name: 'John', age: 30 });
    });

    it('should throw for invalid data', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      await expect(
        parseSchema(schema, { name: 'John', age: 'invalid' }),
      ).rejects.toBeDefined();
    });

    it('should return undefined for undefined schema', async () => {
      const result = await parseSchema(undefined as any, { name: 'John' });

      expect(result).toBeUndefined();
    });

    it('should parse string schema', async () => {
      const schema = z.string().min(3);

      const result = await parseSchema(schema, 'test');

      expect(result).toBe('test');
    });

    it('should throw for string that is too short', async () => {
      const schema = z.string().min(5);

      await expect(parseSchema(schema, 'abc')).rejects.toBeDefined();
    });

    it('should parse number schema', async () => {
      const schema = z.number().positive();

      const result = await parseSchema(schema, 42);

      expect(result).toBe(42);
    });

    it('should throw for negative number when positive required', async () => {
      const schema = z.number().positive();

      await expect(parseSchema(schema, -5)).rejects.toBeDefined();
    });

    it('should parse optional fields', async () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      const result = await parseSchema(schema, { required: 'value' });

      expect(result).toEqual({ required: 'value' });
    });

    it('should parse with defaults', async () => {
      const schema = z.object({
        name: z.string(),
        role: z.string().default('user'),
      });

      const result = await parseSchema(schema, { name: 'John' });

      expect(result).toEqual({ name: 'John', role: 'user' });
    });

    it('should parse enum values', async () => {
      const schema = z.object({
        status: z.enum(['active', 'inactive', 'pending']),
      });

      const result = await parseSchema(schema, { status: 'active' });

      expect(result).toEqual({ status: 'active' });
    });

    it('should throw for invalid enum value', async () => {
      const schema = z.object({
        status: z.enum(['active', 'inactive']),
      });

      await expect(
        parseSchema(schema, { status: 'invalid' }),
      ).rejects.toBeDefined();
    });

    it('should parse union types', async () => {
      const schema = z.union([z.string(), z.number()]);

      const result1 = await parseSchema(schema, 'text');
      const result2 = await parseSchema(schema, 42);

      expect(result1).toBe('text');
      expect(result2).toBe(42);
    });

    it('should throw for invalid union value', async () => {
      const schema = z.union([z.string(), z.number()]);

      await expect(parseSchema(schema, true)).rejects.toBeDefined();
    });

    it('should parse array of objects', async () => {
      const schema = z.array(
        z.object({
          id: z.number(),
          name: z.string(),
        }),
      );

      const result = await parseSchema(schema, [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);

      expect(result).toEqual([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);
    });

    it('should validate required fields', async () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      await expect(
        parseSchema(schema, { optional: 'value' }),
      ).rejects.toBeDefined();
    });
  });
});
