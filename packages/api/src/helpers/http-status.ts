/**
 * Utility functions for HTTP status code handling
 */

/**
 * Checks if an HTTP status code represents a successful response (2xx range)
 *
 * @param status - The HTTP status code to check
 * @returns True if the status code is in the 2xx range (200-299), false otherwise
 *
 * @example
 * ```typescript
 * isSuccessStatus(200) // true
 * isSuccessStatus(201) // true
 * isSuccessStatus(404) // false
 * isSuccessStatus(500) // false
 * ```
 */
export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}
