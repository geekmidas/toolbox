import { bench, describe } from 'vitest';
import { z } from 'zod';
import { convertStandardSchemaToJsonSchema } from '../conversion';

describe('Schema Conversion - Simple', () => {
  const simpleSchema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
  });

  bench('simple object schema', async () => {
    await convertStandardSchemaToJsonSchema(simpleSchema);
  });

  const primitiveSchema = z.string();
  bench('primitive string schema', async () => {
    await convertStandardSchemaToJsonSchema(primitiveSchema);
  });

  const arraySchema = z.array(z.string());
  bench('array of strings schema', async () => {
    await convertStandardSchemaToJsonSchema(arraySchema);
  });
});

describe('Schema Conversion - Complex', () => {
  const nestedSchema = z.object({
    user: z.object({
      profile: z.object({
        name: z.string(),
        bio: z.string().optional(),
        settings: z.record(z.string(), z.unknown()),
      }),
      contacts: z.array(
        z.object({
          type: z.enum(['email', 'phone']),
          value: z.string(),
        }),
      ),
    }),
    metadata: z.object({
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  });

  bench('deeply nested schema', async () => {
    await convertStandardSchemaToJsonSchema(nestedSchema);
  });

  const unionSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), content: z.string() }),
    z.object({ type: z.literal('image'), url: z.string() }),
    z.object({
      type: z.literal('video'),
      url: z.string(),
      duration: z.number(),
    }),
  ]);

  bench('discriminated union schema', async () => {
    await convertStandardSchemaToJsonSchema(unionSchema);
  });

  const largeSchema = z.object(
    Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`field${i}`, z.string()]),
    ),
  );

  bench('large object (50 fields)', async () => {
    await convertStandardSchemaToJsonSchema(largeSchema);
  });
});

describe('Schema Conversion - With Refinements', () => {
  const refinedSchema = z.object({
    age: z.number().min(0).max(150),
    email: z.string().email(),
    url: z.string().url(),
    uuid: z.string().uuid(),
  });

  bench('schema with refinements', async () => {
    await convertStandardSchemaToJsonSchema(refinedSchema);
  });
});
