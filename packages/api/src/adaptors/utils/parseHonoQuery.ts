import type { Context } from 'hono';

/**
 * Parse Hono query parameters to handle arrays and nested objects
 * Hono provides c.req.queries() for arrays, but we need to handle dot notation for objects
 */
export function parseHonoQuery(c: Context): Record<string, any> {
  const allParams = c.req.query();
  const result: Record<string, any> = {};

  // First, handle all query parameters
  for (const [key, value] of Object.entries(allParams)) {
    if (key.includes('.')) {
      // Handle dot notation for objects
      const parts = key.split('.');
      let current = result;

      // Navigate/create the nested structure
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (
          !current[part] ||
          typeof current[part] !== 'object' ||
          Array.isArray(current[part])
        ) {
          current[part] = {};
        }
        current = current[part];
      }

      // Set the final value, checking for arrays in nested keys
      const lastPart = parts[parts.length - 1];
      const multipleValues = c.req.queries(key);
      if (multipleValues && multipleValues.length > 1) {
        current[lastPart] = multipleValues;
      } else {
        current[lastPart] = value;
      }
    } else {
      // For regular keys, check if there are multiple values
      const multipleValues = c.req.queries(key);
      if (multipleValues && multipleValues.length > 1) {
        result[key] = multipleValues;
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}
