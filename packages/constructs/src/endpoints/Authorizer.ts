/**
 * Represents an authorizer configuration for endpoints
 */
export interface Authorizer {
  /**
   * Unique identifier for the authorizer
   */
  name: string;
  /**
   * Type of authorizer (e.g., 'iam', 'jwt', 'custom')
   */
  type?: string;
  /**
   * Description of what this authorizer does
   */
  description?: string;
  /**
   * Additional metadata specific to the authorizer type
   */
  metadata?: Record<string, any>;
}

/**
 * Helper to create an authorizer configuration
 */
export function createAuthorizer(
  name: string,
  options?: Omit<Authorizer, 'name'>,
): Authorizer {
  return {
    name,
    ...options,
  };
}
