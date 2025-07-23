# Getting Started

## Prerequisites

- Node.js >= 22.0.0
- pnpm >= 10.11.0

## Installation

Install the packages you need:

```bash
# For API development
pnpm add @geekmidas/api

# For testing utilities
pnpm add -D @geekmidas/testkit

# For environment configuration
pnpm add @geekmidas/envkit
```

## Quick Start

### Building a REST API

```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

const createUser = e
  .post('/users')
  .body(z.object({
    name: z.string(),
    email: z.string().email(),
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }))
  .handle(async ({ body }) => {
    // Your logic here
    return {
      id: '123',
      ...body,
    };
  });
```

### Environment Configuration

```typescript
import { EnvironmentParser } from '@geekmidas/envkit';

const config = new EnvironmentParser(process.env)
  .create((get) => ({
    port: get('PORT').string().transform(Number).default(3000),
    database: {
      url: get('DATABASE_URL').string().url(),
    },
  }))
  .parse();
```

### Testing with Factories

```typescript
import { KyselyFactory } from '@geekmidas/testkit/kysely';

const factory = new KyselyFactory(builders, seeds, db);

// Create test data
const user = await factory.insert('user', {
  name: 'Test User',
  email: 'test@example.com',
});
```