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

### Running Tests

```bash
pnpm test              # Watch mode
pnpm test:once         # Single run with coverage
pnpm test:ui           # Visual UI
pnpm test path/to/file # Specific file
```

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

Use Mock Service Worker for external HTTP APIs:

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
