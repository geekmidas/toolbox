import type { StandardSchemaV1 } from '@standard-schema/spec';

export const StandardSchemaJsonSchema = {
  zod: async (schema) => {
    const { z } = await import('zod/v4');
    return z.toJSONSchema(schema, { unrepresentable: 'any' });
  },
  valibot: async (schema) => {
    const { toJsonSchema } = await import('@valibot/to-json-schema');
    return toJsonSchema(schema as any);
  },
};

export async function convertStandardSchemaToJsonSchema(
  schema?: StandardSchemaV1,
): Promise<any> {
  if (!schema) {
    return undefined;
  }

  const vendor = schema['~standard']?.vendor;
  if (!vendor) {
    throw new Error(
      'Standard Schema does not have a valid vendor. Please ensure the schema is valid.',
    );
  }
  if (vendor in StandardSchemaJsonSchema) {
    return StandardSchemaJsonSchema[vendor](schema);
  }

  throw new Error(
    `Unsupported vendor "${vendor}" for Standard Schema. Supported vendors are: ${Object.keys(StandardSchemaJsonSchema).join(', ')}`,
  );
}
