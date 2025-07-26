import { faker as baseFaker } from '@faker-js/faker';

// NOTE: This is a simple way to extend `faker` with additional methods

/**
 * Atomic counter implementation for thread-safe sequence generation.
 * Provides a clean abstraction for generating sequential numbers in tests.
 * While JavaScript is single-threaded, this class makes the intent explicit.
 *
 * @example
 * ```typescript
 * const counter = new AtomicCounter(100);
 * console.log(counter.increment()); // 101
 * console.log(counter.increment()); // 102
 * console.log(counter.get()); // 102
 * counter.reset(200);
 * console.log(counter.increment()); // 201
 * ```
 */
class AtomicCounter {
  /**
   * The current counter value.
   * @private
   */
  private value: number;

  /**
   * Creates a new atomic counter.
   * @param initialValue - The starting value (default: 0)
   */
  constructor(initialValue = 0) {
    this.value = initialValue;
  }

  /**
   * Increments the counter and returns the new value.
   * @returns The incremented value
   */
  increment(): number {
    // In Node.js, JavaScript is single-threaded within the event loop,
    // so this operation is already atomic. However, this class provides
    // a cleaner abstraction and makes the intent explicit.
    return ++this.value;
  }

  /**
   * Gets the current counter value without incrementing.
   * @returns The current value
   */
  get(): number {
    return this.value;
  }

  /**
   * Resets the counter to a specific value.
   * @param value - The new value (default: 0)
   */
  reset(value = 0): void {
    this.value = value;
  }
}

/**
 * Generates random timestamp fields for database records.
 * Creates a createdAt date in the past and an updatedAt date between creation and now.
 * Milliseconds are set to 0 for cleaner database storage.
 *
 * @returns Object with createdAt and updatedAt Date fields
 *
 * @example
 * ```typescript
 * const { createdAt, updatedAt } = timestamps();
 * console.log(createdAt); // 2023-05-15T10:30:00.000Z
 * console.log(updatedAt); // 2023-11-20T14:45:00.000Z
 *
 * // Use in factory
 * const user = {
 *   name: 'John Doe',
 *   ...timestamps()
 * };
 * ```
 */
export function timestamps(): Timestamps {
  const createdAt = faker.date.past();
  const updatedAt = faker.date.between({
    from: createdAt,
    to: new Date(),
  });

  createdAt.setMilliseconds(0);
  updatedAt.setMilliseconds(0);

  return { createdAt, updatedAt };
}

/**
 * Generates a reverse domain name identifier.
 * Useful for creating unique identifiers that follow domain naming conventions.
 *
 * @param suffix - Optional suffix to append to the identifier
 * @returns A reverse domain name string (e.g., "com.example.feature123")
 *
 * @example
 * ```typescript
 * console.log(identifier()); // "com.example.widget1"
 * console.log(identifier('user')); // "org.acme.user"
 * console.log(identifier('api')); // "net.demo.api"
 * ```
 */
export function identifier(suffix?: string): string {
  return [
    faker.internet.domainSuffix(),
    faker.internet.domainWord(),
    suffix ? suffix : faker.internet.domainWord() + sequence('identifier'),
  ].join('.');
}

/**
 * Storage for named sequence counters.
 * Each sequence maintains its own independent counter.
 * @private
 */
const sequences = new Map<string, AtomicCounter>();

/**
 * Generates sequential numbers for a named sequence.
 * Useful for creating unique IDs or numbered test data.
 * Each named sequence maintains its own counter.
 *
 * @param name - The sequence name (default: 'default')
 * @returns The next number in the sequence
 *
 * @example
 * ```typescript
 * console.log(sequence()); // 1
 * console.log(sequence()); // 2
 * console.log(sequence('user')); // 1
 * console.log(sequence('user')); // 2
 * console.log(sequence()); // 3
 *
 * // Use in factories
 * const email = `user${sequence('email')}@example.com`;
 * ```
 */
export function sequence(name = 'default'): number {
  if (!sequences.has(name)) {
    sequences.set(name, new AtomicCounter());
  }

  const counter = sequences.get(name) as AtomicCounter;
  return counter.increment();
}

/**
 * Resets a named sequence counter to a specific value.
 * Useful for resetting sequences between test suites.
 *
 * @param name - The sequence name to reset (default: 'default')
 * @param value - The new starting value (default: 0)
 *
 * @example
 * ```typescript
 * sequence('user'); // 1
 * sequence('user'); // 2
 * resetSequence('user');
 * sequence('user'); // 1
 *
 * resetSequence('order', 1000);
 * sequence('order'); // 1001
 * ```
 */
export function resetSequence(name = 'default', value = 0): void {
  if (sequences.has(name)) {
    const counter = sequences.get(name) as AtomicCounter;
    counter.reset(value);
  } else {
    sequences.set(name, new AtomicCounter(value));
  }
}

/**
 * Resets all sequence counters.
 * Useful for cleaning up between test suites to ensure predictable sequences.
 *
 * @example
 * ```typescript
 * // In test setup
 * beforeEach(() => {
 *   resetAllSequences();
 * });
 *
 * it('starts sequences from 1', () => {
 *   expect(sequence()).toBe(1);
 *   expect(sequence('user')).toBe(1);
 * });
 * ```
 */
export function resetAllSequences(): void {
  sequences.clear();
}

/**
 * Generates a random price as a number.
 * Converts faker's string price to a numeric value.
 *
 * @returns A random price number
 *
 * @example
 * ```typescript
 * const productPrice = price(); // 29.99
 * const total = price() * quantity; // Numeric calculation
 * ```
 */
function price(): number {
  return +faker.commerce.price();
}

/**
 * Enhanced faker instance with additional utility methods for testing.
 * Extends @faker-js/faker with custom methods for common test data generation patterns.
 *
 * @example
 * ```typescript
 * import { faker } from '@geekmidas/testkit';
 *
 * // Use standard faker methods
 * const name = faker.person.fullName();
 * const email = faker.internet.email();
 *
 * // Use custom extensions
 * const { createdAt, updatedAt } = faker.timestamps();
 * const id = faker.identifier('user');
 * const orderNumber = faker.sequence('order');
 * const productPrice = faker.price();
 * ```
 */
export const faker = Object.freeze(
  Object.assign({}, baseFaker, {
    timestamps,
    identifier,
    sequence,
    resetSequence,
    resetAllSequences,
    price,
  }),
);

/**
 * Type definition for timestamp fields.
 * Used by the timestamps() function to generate date fields.
 */
export type Timestamps = {
  /** The creation date */
  createdAt: Date;
  /** The last update date */
  updatedAt: Date;
};

/**
 * Type definition for the enhanced faker factory.
 * Includes all standard faker methods plus custom extensions.
 */
export type FakerFactory = typeof faker;
