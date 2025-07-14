import { faker as baseFaker } from '@faker-js/faker';

// NOTE: This is a simple way to extend `faker` with additional methods

/**
 * Atomic counter implementation for thread-safe sequence generation
 */
class AtomicCounter {
  private value: number;

  constructor(initialValue = 0) {
    this.value = initialValue;
  }

  increment(): number {
    // In Node.js, JavaScript is single-threaded within the event loop,
    // so this operation is already atomic. However, this class provides
    // a cleaner abstraction and makes the intent explicit.
    return ++this.value;
  }

  get(): number {
    return this.value;
  }

  reset(value = 0): void {
    this.value = value;
  }
}

/**
 * Sets the `insertedAt` and `updatedAt` to a random date in the past.
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
 * Returns a reverse domain name identifier.
 */
export function identifier(suffix?: string): string {
  return [
    faker.internet.domainSuffix(),
    faker.internet.domainWord(),
    suffix ? suffix : faker.internet.domainWord() + sequence('identifier'),
  ].join('.');
}

// Atomic sequences for thread-safe counter generation
const sequences = new Map<string, AtomicCounter>();

export function sequence(name = 'default'): number {
  if (!sequences.has(name)) {
    sequences.set(name, new AtomicCounter());
  }

  const counter = sequences.get(name) as AtomicCounter;
  return counter.increment();
}

/**
 * Resets a sequence counter to a specific value (default: 0)
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
 * Resets all sequence counters
 */
export function resetAllSequences(): void {
  sequences.clear();
}

/**
 * Returns a random price number.
 */
function price(): number {
  return +faker.commerce.price();
}

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

export type Timestamps = {
  createdAt: Date;
  updatedAt: Date;
};

export type FakerFactory = typeof faker;
