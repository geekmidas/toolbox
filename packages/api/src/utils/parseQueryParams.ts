/**
 * Parse query parameters from a flat object into a nested structure
 * Handles arrays (multiple values with same key) and objects (dot notation)
 *
 * @example
 * parseQueryParams({ 'tags': ['a', 'b'], 'filter.name': 'john' })
 * // Returns: { tags: ['a', 'b'], filter: { name: 'john' } }
 */
export function parseQueryParams(
  queryParams: Record<string, string | string[] | undefined> | null,
): Record<string, any> {
  if (!queryParams) {
    return {};
  }

  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(queryParams)) {
    if (value === undefined) {
      continue;
    }

    // Check if the key contains dot notation
    if (key.includes('.')) {
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

      // Set the final value
      const lastPart = parts[parts.length - 1];
      current[lastPart] = value;
    } else {
      // Simple key, just assign the value
      result[key] = value;
    }
  }

  return result;
}
