import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { InferStandardSchema } from './types';

/**
 * Validates data against a StandardSchema.
 *
 * @param schema - The StandardSchema to validate against
 * @param data - The data to validate
 * @returns Validation result with value or issues
 */
export function validate<T extends StandardSchemaV1>(schema: T, data: unknown) {
  return schema['~standard'].validate(data);
}

export async function parseSchema<T extends StandardSchemaV1>(
  schema: T,
  data: unknown,
): Promise<InferStandardSchema<T>> {
  if (!schema) {
    return undefined as InferStandardSchema<T>;
  }

  const parsed = await validate(schema as unknown as StandardSchemaV1, data);

  if (parsed.issues) {
    throw parsed.issues;
  }

  return parsed.value as InferStandardSchema<T>;
}
