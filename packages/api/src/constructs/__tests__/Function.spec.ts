import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { FunctionBuilder } from '../Function';

describe('Function', () => {
  describe('.parseComposableStandardSchema', () => {
    it('should parse standard schema', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number().optional(),
      });

      const data = { name: 'John', age: 30 };
      const result = await FunctionBuilder.parseComposableStandardSchema(
        data,
        schema,
      );
      expect(result).toEqual({ name: 'John', age: 30 });
    });

    it('should parse composed schema', async () => {
      const schema = {
        name: z.string(),
        age: z.number().optional(),
      };

      const data = { name: 'John', age: 30 };
      const result = await FunctionBuilder.parseComposableStandardSchema(
        data,
        schema,
      );
      expect(result).toEqual({ name: 'John', age: 30 });
    });
  });
});
