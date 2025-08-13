import type { StandardSchemaV1 } from '@standard-schema/spec';

export const StandardSchemaJsonSchema = {
  zod: async (schema): Promise<any> => {
    const { z } = await import('zod/v4');
    return z.toJSONSchema(schema, { unrepresentable: 'any' });
  },
  valibot: async (schema): Promise<any> => {
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
    const toJSONSchema = StandardSchemaJsonSchema[vendor];

    return toJSONSchema(schema);
  }

  throw new Error(
    `Unsupported vendor "${vendor}" for Standard Schema. Supported vendors are: ${Object.keys(StandardSchemaJsonSchema).join(', ')}`,
  );
}

export async function getZodMetadata(
  schema: StandardSchemaV1,
): Promise<SchemaMeta | undefined> {
  const { ZodObject } = await import('zod/v4');

  if (schema instanceof ZodObject) {
    return schema.meta();
  }

  return undefined;
}

export async function getSchemaMetadata(
  schema: StandardSchemaV1,
): Promise<SchemaMeta | undefined> {
  const vendor = schema['~standard']?.vendor;

  if (vendor === 'zod') {
    return getZodMetadata(schema);
  }

  return undefined;
}

interface SchemaMeta {
  id?: string;
}

export async function convertSchemaWithComponents(
  schema: StandardSchemaV1 | undefined,
  componentCollector?: {
    addSchema(id: string, schema: any): void;
    getReference(id: string): { $ref: string };
  },
): Promise<any> {
  if (!schema) {
    return undefined;
  }

  const jsonSchema = await convertStandardSchemaToJsonSchema(schema);
  if (!jsonSchema || !componentCollector) {
    return jsonSchema;
  }

  // Check if this schema has metadata with an ID
  const metadata = await getSchemaMetadata(schema);

  if (metadata?.id) {
    // Add the schema to components
    componentCollector.addSchema(metadata.id, jsonSchema);
    // Return a reference to the component
    return componentCollector.getReference(metadata.id);
  }

  return jsonSchema;
}
