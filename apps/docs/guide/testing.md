# Testing Guide

This guide covers testing patterns and best practices for @geekmidas applications.

## Testing Philosophy

The project follows an **"Integration over Unit"** testing philosophy:

1. **Integration over Unit** - Prefer tests that verify complete integration between components
2. **Behavior over Implementation** - Test what the code does, not how it works internally
3. **Real Dependencies over Mocks** - Use actual implementations when possible
4. **Comprehensive Coverage** - Test both happy paths and edge cases

## Setup

### Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      thresholds: {
        functions: 85,
        branches: 85,
      },
    },
  },
});
```

### Where the test database comes from

`gkm test` reconciles the **test** stage before the suite runs: the same
containers `gkm dev` uses, with the resources named for the stage. So there is
no `docker compose up` in a test script and no `DATABASE_URL` to set — a
declared database is what makes a Postgres exist, and its URL is injected under
the key that database publishes.

```typescript
// test/config.ts
import { it as itVitest } from 'vitest';
import { wrapVitestKyselyTransaction } from '@geekmidas/testkit/kysely';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from '../src/constructs/database.ts';

const connection = new Kysely<Database>({
  dialect: new PostgresDialect({
    // `ORDERS_URL` for `new KyselyDatabase<Database, 'Orders'>('Orders')`.
    pool: new pg.Pool({ connectionString: process.env.ORDERS_URL }),
  }),
});

export const it = wrapVitestKyselyTransaction<Database>(itVitest, { connection });
```

Migrations connect as the **owner** role — `ORDERS_OWNER_URL`, the one that may
create, alter, and drop. A handler is never given it: `.dependsOn()` takes
constructs, and `.owner` is a `Service`, so a handler cannot ask for DDL rights
at all.

```bash
gkm test                    # reconcile the test stage, then run
gkm test --run --coverage   # once, with coverage
GKM_AUTO_SETUP=1 gkm test   # CI: generate a fresh stage when none exists
```

### Running Tests

```bash
pnpm test              # Watch mode
pnpm test:once         # Single run with coverage
pnpm test:ui           # Visual UI
pnpm test path/to/file # Specific file
```

## Feature Tests

`gkm test` generates `#test`: an `it` that hands each test what it uses, by
name, so a test imports nothing but `it`:

```typescript
import { it } from '#test';

it('updates my profile', async ({ browser, faker }) => {
  const { user } = await browser.signIn();
  await browser.api.post('/users', {
    body: { name: faker.person.fullName(), email: user.email },
  });
  // …
});
```

- **`browser.signIn()`** signs in through the auth server's magic link, the way
  a person does: the email really sent to Mailpit, the link really followed.
  With no address it signs in as somebody new, unique to the test, and
  `user.email` says who. Pass an address when the test needs a particular one.
- **`faker`** is testkit's faker, the same one factories are given, seeded
  from the test's name: a failing test fails again with the same data.
- **An `ExternalApi`'s fake** — `test/fakes/<id>.ts` — answers at the URL the
  test stage resolved for it, so a handler that calls Polar calls the fake with
  nothing for the test to set up. See [Fakes](#fakes).

## Fakes

A fake stands in for an API somebody else runs — Polar, a carrier, a payment
gateway — wherever the real one can't be called: in every feature test, and in
`gkm dev --fake`. It is a **working implementation** of the API, not a mock:
the client under test talks HTTP to it exactly as it would to the provider,
and the test asserts on what the endpoint did and what the fake received,
never on which functions were called.

### Where a fake lives

One file per [`ExternalApi`](/packages/constructs#an-api-somebody-else-runs),
at `test/fakes/<id>.ts` in the workspace root — the construct's id in kebab
case, so `Shipping` is `test/fakes/shipping.ts` and `PayFast` is
`test/fakes/pay-fast.ts`. gkm finds it by that path, the way it finds
`test/factories/<database>.ts`.

The construct never imports its fake. That is what keeps a fake, and the
responses it answers from, out of every deployed bundle, however a bundler
follows imports.

### Writing one

Default-export `fake.app(…)` with a fetch handler — a Hono app is the usual
one — and the credentials the fake accepts:

```typescript
// test/fakes/shipping.ts
import { fake } from '@geekmidas/constructs/external-api';
import type { shipping } from '../../constructs/shipping';
import { Hono } from 'hono';

const carrier = new Hono().post('/quotes', async (c) => {
  // Refuse what the provider refuses, so the client's error path is tested.
  if (c.req.header('authorization') !== 'Bearer fake-key') {
    return c.json({ error: 'unknown key' }, 401);
  }

  const { destination, weightKg } = await c.req.json();
  return c.json({ destination, amount: 50 + weightKg * 10 });
});

export default fake.app<typeof shipping>(carrier, {
  credentials: { apiKey: 'fake-key' },
});
```

- **Answer in the provider's shape.** Start from a recorded response — the
  provider's docs, or a sandbox call saved as JSON beside the fake — so the
  client parses what it will parse in production.
- **Cover the paths the client handles**: the refusal for bad credentials, a
  missing resource, a rate limit. A fake that only ever succeeds tests only
  the happy path.
- **`credentials`** are what a test and `gkm dev --fake` hand the construct as
  `<ID>_CREDENTIALS`. `fake.app<typeof shipping>` checks them against the
  construct's schema, and the handler checks them the way the provider would.

### Asserting on what it received

A fake can export more than its default. Keep what it was asked for, export a
way to read it, and read it in the test through `fake(construct)` — the
module's named exports, from the same instance the harness serves:

```typescript
// test/fakes/shipping.ts
const asked = new Map<string, QuoteRequest[]>();

export function quotesFor(destination: string): QuoteRequest[] {
  return asked.get(destination) ?? [];
}

// …in the handler: asked.set(destination, [...quotesFor(destination), request])
```

```typescript
// apps/api/__tests__/shipping.spec.ts
import { shipping } from '~/constructs/shipping';
import { it } from '#test';

it('asks the carrier for exactly the parcel it was given', async ({
  browser,
  fake,
  faker,
}) => {
  const destination = faker.location.city();

  await browser.api.post('/shipping/quotes', {
    body: { destination, weightKg: 3.5 },
  });

  expect(fake(shipping).quotesFor(destination)).toEqual([
    { destination, weightKg: 3.5 },
  ]);
});
```

`fake(…)` is keyed by the construct, like `queue(…)` and `published(…)`, and
typed from the fake module's exports — reading a fake the app does not declare
is a type error, not a relative import that resolves to the wrong file. Only
the named exports are handed over; the default export is the fake being served.
An image fake runs as a container and shares no state with the test, so
`fake(…)` refuses it (`ImageFakeHasNoState`): assert through the provider's own
API instead.

### Background work, end to end

What a request publishes is delivered before the test sees the response —
in-process, no broker, no Docker:

- A **queue**'s messages go to its one consumer, as a batch.
- A **topic**'s events go to every subscriber that named that event type, and
  only those — the fan-out the broker does deployed.
- Each payload is checked against the consumer's schema first, so a producer
  sending the wrong shape fails the test (`MessageRejected`).
- Consumers run in the **test's transaction**: they see the rows the endpoint
  wrote, and what they write rolls back with the test.
- What a consumer publishes is delivered in turn, until nothing is left. A
  chain that never settles fails with `DeliveryDidNotSettle`.
- A consumer that throws fails the test (`DeliveryFailed`). Deployed, the
  message would be retried; here that would only hide the bug.

```typescript
it('writes a notification when a user is created', async ({ browser, db }) => {
  const user = await browser.api.post('/users', { body: { name: 'Ada', email } });

  // The `user.created` subscriber has already run.
  const app = await db.get('database');
  expect(
    await app.selectFrom('notifications').where('user_id', '=', user.id).execute(),
  ).toHaveLength(1);
});
```

What is tested is the contract: what a handler is handed — `messages` for a
queue, `events` (`{ type, payload }`) for a subscriber. Turning an SNS envelope
or an SQS record into that shape is each adaptor's job, and tested there. One
thing to know: a transport carries JSON, so a `Date` in a payload arrives as a
string deployed — write payload schemas with `z.iso.datetime()`, not
`z.date()`.

`published(topic)` still records everything published, and
`queue(q).invoke(...)` / `subscriber(s).invoke(...)` run a consumer on its own —
a redelivery, say — and deliver whatever it publishes.

### State lives for the test file

A fake is loaded once per test file, not once per test, so what it keeps
carries over from one test to the next in the same file. Read state by a key
the test chose — a destination, a user id, an email from the test's `faker` —
rather than the whole list, as above. Where that isn't possible, export a
`reset()` from the fake and call it in a `beforeEach`. Different test files
never share a fake's state.

### A provider's own local server

Where the provider publishes one — Stripe's `stripe-mock` — use its image
instead of writing a fake. It runs as a container beside Postgres and Mailpit,
on an allocated host port, in tests and in `gkm dev --fake`:

```typescript
// test/fakes/stripe.ts
import { fake } from '@geekmidas/constructs/external-api';
import type { stripe } from '../../constructs/stripe';

export default fake.image<typeof stripe>('stripe/stripe-mock', {
  port: 12111, // the port the image listens on inside the container
  credentials: { secretKey: 'sk_test_fake', webhookSecret: 'whsec_fake' },
});
```

There is nothing to import from an image fake: assert on what the endpoint
returned, or on what the provider's server reports through its own API.

### In `gkm dev`

`gkm dev` calls the real API — its sandbox — with the local stage's own
credentials. `gkm dev --fake` serves every app fake on a port of its own and
runs every image fake, and the apps it starts are pointed at them.

### When there is none

`gkm test` and `gkm dev --fake` stop before anything runs:

| Error | Means |
|---|---|
| `NoFake` | an `ExternalApi` has no `test/fakes/<id>.ts`; the message names the file to create |
| `NotAFake` | the file's default export isn't `fake.app(…)` or `fake.image(…)` |

Commands that act on a stage — `gkm setup`, `secrets:*`, `deploy` — never read
a fake, and don't need one to exist.

## Unit Testing

### Testing Services

```typescript
import { describe, it, expect } from 'vitest';
import { InMemoryCache } from '@geekmidas/cache/memory';
import { UserService } from './user-service';

describe('UserService', () => {
  it('should cache user after fetch', async () => {
    // Use real cache implementation
    const cache = new InMemoryCache<User>();
    const service = new UserService({ cache });

    const user = await service.getUser('123');

    // Verify behavior
    expect(user.id).toBe('123');
    expect(await cache.get('user:123')).toEqual(user);
  });
});
```

### Testing with Factories

```typescript
import { describe, it, expect } from 'vitest';
import { faker } from '@geekmidas/testkit/faker';

describe('OrderCalculator', () => {
  it('should calculate total with tax', () => {
    const items = [
      { name: faker.commerce.productName(), price: 10.00, quantity: 2 },
      { name: faker.commerce.productName(), price: 25.00, quantity: 1 },
    ];

    const result = calculateOrder(items, { taxRate: 0.1 });

    expect(result.subtotal).toBe(45.00);
    expect(result.tax).toBe(4.50);
    expect(result.total).toBe(49.50);
  });
});
```

## Integration Testing

### Database Integration

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KyselyFactory } from '@geekmidas/testkit/kysely';
import { VitestKyselyTransactionIsolator } from '@geekmidas/testkit/kysely';
import { db, builders, seeds } from './test-setup';

describe('UserRepository', () => {
  const isolator = new VitestKyselyTransactionIsolator(db);
  const factory = new KyselyFactory(builders, seeds, db);

  beforeEach(async () => {
    await isolator.begin();
  });

  afterEach(async () => {
    await isolator.rollback();
  });

  it('should create user with profile', async () => {
    // Create test data
    const user = await factory.insert('user', {
      email: 'test@example.com',
    });

    // Test the repository
    const result = await userRepository.findById(user.id);

    expect(result).toMatchObject({
      id: user.id,
      email: 'test@example.com',
    });
  });

  it('should use seed for complex scenario', async () => {
    // Use a seed for complex data setup
    const { user, posts } = await factory.seed('userWithPosts');

    const result = await userRepository.getUserWithPosts(user.id);

    expect(result.posts).toHaveLength(posts.length);
  });
});
```

### API Endpoint Testing

```typescript
import { describe, it, expect } from 'vitest';
import { createTestApp } from '@geekmidas/constructs/testing';
import { createUserEndpoint, getUserEndpoint } from './endpoints';

describe('User API', () => {
  const app = createTestApp([createUserEndpoint, getUserEndpoint]);

  it('should create and retrieve user', async () => {
    // Create user
    const createRes = await app
      .post('/users')
      .send({ name: 'John Doe', email: 'john@example.com' })
      .expect(201);

    expect(createRes.body).toMatchObject({
      id: expect.any(String),
      name: 'John Doe',
    });

    // Retrieve user
    const getRes = await app
      .get(`/users/${createRes.body.id}`)
      .expect(200);

    expect(getRes.body.email).toBe('john@example.com');
  });

  it('should validate input', async () => {
    const res = await app
      .post('/users')
      .send({ name: '' }) // Invalid: missing email
      .expect(400);

    expect(res.body.error).toBeDefined();
  });
});
```

## Mocking External APIs with MSW

An API declared as an [`ExternalApi`](/packages/constructs#an-api-somebody-else-runs)
needs none of this in a feature test: its fake is served at its URL for you.
For code that calls an API directly, use Mock Service Worker:

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// Define handlers
const handlers = [
  http.get('https://api.stripe.com/v1/customers/:id', ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      email: 'customer@example.com',
    });
  }),
  http.post('https://api.stripe.com/v1/charges', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      id: 'ch_test123',
      amount: body.amount,
      status: 'succeeded',
    });
  }),
];

const server = setupServer(...handlers);

describe('PaymentService', () => {
  beforeAll(() => server.listen());
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('should process payment', async () => {
    const result = await paymentService.charge({
      customerId: 'cus_123',
      amount: 1000,
    });

    expect(result.status).toBe('succeeded');
  });

  it('should handle API errors', async () => {
    // Override handler for this test
    server.use(
      http.post('https://api.stripe.com/v1/charges', () => {
        return HttpResponse.json(
          { error: { message: 'Card declined' } },
          { status: 402 }
        );
      })
    );

    await expect(
      paymentService.charge({ customerId: 'cus_123', amount: 1000 })
    ).rejects.toThrow('Card declined');
  });
});
```

## Testing Authentication

```typescript
import { describe, it, expect } from 'vitest';
import { createTestApp } from '@geekmidas/constructs/testing';
import { JwtVerifier } from '@geekmidas/auth/jwt';
import { protectedEndpoint } from './endpoints';

describe('Protected Endpoints', () => {
  const verifier = new JwtVerifier({ secret: 'test-secret' });
  const app = createTestApp([protectedEndpoint]);

  it('should reject without token', async () => {
    await app.get('/profile').expect(401);
  });

  it('should accept valid token', async () => {
    const token = await verifier.sign({ sub: 'user-123', role: 'admin' });

    const res = await app
      .get('/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.userId).toBe('user-123');
  });

  it('should reject expired token', async () => {
    const token = await verifier.sign(
      { sub: 'user-123' },
      { expiresIn: '-1h' } // Already expired
    );

    await app
      .get('/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
```

## Testing Events

```typescript
import { describe, it, expect, vi } from 'vitest';
import { BasicPublisher, BasicSubscriber } from '@geekmidas/events/basic';

describe('Event System', () => {
  it('should publish and receive events', async () => {
    const publisher = new BasicPublisher();
    const subscriber = new BasicSubscriber();
    const handler = vi.fn();

    await subscriber.subscribe(['user.created'], handler);

    await publisher.publish([
      { type: 'user.created', payload: { userId: '123' } },
    ]);

    // Allow async processing
    await new Promise((r) => setTimeout(r, 10));

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'user.created',
        payload: { userId: '123' },
      })
    );
  });
});
```

## Enhanced Faker Utilities

The testkit provides enhanced faker utilities:

```typescript
import { faker } from '@geekmidas/testkit/faker';

// Timestamps for database records
const timestamps = faker.timestamps();
// { createdAt: Date, updatedAt: Date }

// Unique sequences
const email1 = `user${faker.sequence('email')}@example.com`; // user1@example.com
const email2 = `user${faker.sequence('email')}@example.com`; // user2@example.com

// Reset sequences between tests
faker.resetSequence('email');
faker.resetAllSequences();

// Prices (as numbers, not strings)
const price = faker.price(); // 29.99

// A birthdate for someone of a given age today
const adult = faker.age(18); // exactly 18
const student = faker.age(18, 24); // 18 to 24, inclusive

// Coordinates within radius
const location = faker.coordinates.within(
  { lat: 40.7128, lng: -74.0060 }, // NYC
  5000 // 5km radius
);

// Coordinates outside radius
const farLocation = faker.coordinates.outside(
  { lat: 40.7128, lng: -74.0060 },
  10000, // min 10km
  50000  // max 50km
);
```

## Performance Testing

```typescript
import { describe, bench } from 'vitest';

describe('Performance', () => {
  bench('should handle 1000 validations', () => {
    for (let i = 0; i < 1000; i++) {
      schema.parse({ name: 'test', email: 'test@example.com' });
    }
  });

  bench('should serialize large response', () => {
    const data = generateLargeDataset(10000);
    JSON.stringify(data);
  });
});
```

Run benchmarks:

```bash
pnpm bench
```

## Snapshot Testing

```typescript
import { describe, it, expect } from 'vitest';

describe('OpenAPI Generation', () => {
  it('should generate consistent schema', async () => {
    const schema = await Endpoint.buildOpenApiSchema([
      usersEndpoint,
      ordersEndpoint,
    ]);

    expect(schema).toMatchSnapshot();
  });
});
```

Update snapshots:

```bash
pnpm test -u
```

## Coverage Requirements

The project enforces minimum coverage:

- **Functions**: 85%
- **Branches**: 85%

Check coverage:

```bash
pnpm test:once --coverage
```

## Best Practices

### Do

- Use real cache/database implementations when possible
- Test behavior, not implementation details
- Use MSW for external HTTP APIs
- Use transaction isolation for database tests
- Reset state between tests
- Test error scenarios and edge cases

### Don't

- Mock internal dependencies heavily
- Test private methods directly
- Skip error scenario tests
- Use shared state between tests
- Hard-code test data (use factories)

### Test File Organization

```
src/
├── users/
│   ├── user-service.ts
│   ├── user-service.spec.ts      # Unit tests
│   └── __tests__/
│       └── user-api.integration.spec.ts
├── __fixtures__/
│   └── users.json                # Shared test data
└── __helpers__/
    └── test-utils.ts             # Shared test utilities
```
