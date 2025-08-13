import { differenceInSeconds } from 'date-fns';

export const getExpirationInSeconds = (
  expiresAt: string | number | Date | undefined | null,
): number => {
  if (!expiresAt) {
    return 0;
  }

  const expirationDate = new Date(expiresAt);
  const now = new Date();

  const secondsLeft = differenceInSeconds(expirationDate, now);

  return Math.max(secondsLeft, 0);
};

export interface Cache<T> {
  /**
   * Retrieves a value from the cache.
   *
   * @param key The key to retrieve the value for.
   */
  get(key: string): Promise<T | undefined>;
  /**
   * Sets a value in the cache.
   *
   * @param key The key to set the value for.
   * @param value The value to cache.
   * @param ttl Optional time-to-live in seconds. If not provided, the value will not expire.
   */
  set(key: string, value: T, ttl?: number): Promise<void>;
  /**
   * Deletes a value from the cache.
   *
   * @param key The key to delete from the cache.
   */
  delete(key: string): Promise<void>;

  /**
   * Retrieves the time-to-live (TTL) for a cached value.
   *
   * @param key The key to retrieve the TTL for.
   * @returns The TTL in seconds, or undefined if the key does not exist.
   */
  ttl(key: string): Promise<number>;
}
