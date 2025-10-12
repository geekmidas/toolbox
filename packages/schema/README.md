# @geekmidas/schema

Type utilities for working with StandardSchema-compatible validation libraries. Provides type inference helpers that work with any validation library implementing the StandardSchema specification (Zod, Valibot, ArkType, etc.).

## Features

- ✅ **Type Inference**: Extract output types from StandardSchema instances
- ✅ **Composable Schemas**: Support for object-based schema composition
- ✅ **Zero Runtime Overhead**: Pure TypeScript types with no runtime code
- ✅ **Universal Compatibility**: Works with any StandardSchema-compatible library
- ✅ **Type Safety**: Full TypeScript type inference and checking

## Installation

```bash
pnpm add @geekmidas/schema
```

## What is StandardSchema?

[StandardSchema](https://github.com/standard-schema/standard-schema) is a standard for schema validation libraries in TypeScript/JavaScript. It provides a unified interface that allows different validation libraries (Zod, Valibot, ArkType, etc.) to be used interchangeably.

This package provides TypeScript utilities to work with StandardSchema-compatible types.

## API Reference

### `InferStandardSchema<T>`

Infers the output type from a StandardSchema instance.

```typescript
type InferStandardSchema<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T>
  : never;
```

### `ComposableStandardSchema`

Type for composable schemas - can be a single schema or an object of schemas.

```typescript
type ComposableStandardSchema =
  | StandardSchemaV1
  | {
      [key: string]: StandardSchemaV1 | undefined;
    };
```

### `InferComposableStandardSchema<T>`

Infers types from composable schemas, supporting both single schemas and schema objects.

```typescript
type InferComposableStandardSchema<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T>
  : T extends { [key: string]: StandardSchemaV1 | undefined }
    ? {
        [K in keyof T as T[K] extends StandardSchemaV1
          ? K
          : never]: T[K] extends StandardSchemaV1
          ? StandardSchemaV1.InferOutput<T[K]>
          : never;
      }
    : {};
```

## Usage with Zod

```typescript
import type { InferStandardSchema } from '@geekmidas/schema';
import { z } from 'zod';

// Define a schema
const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  age: z.number().min(18),
  role: z.enum(['admin', 'user'])
});

// Infer the type
type User = InferStandardSchema<typeof userSchema>;
// type User = {
//   id: string;
//   email: string;
//   age: number;
//   role: 'admin' | 'user';
// }

// Use the type
function processUser(user: User) {
  console.log(user.email);
}
```

## Usage with Valibot

```typescript
import type { InferStandardSchema } from '@geekmidas/schema';
import * as v from 'valibot';

const productSchema = v.object({
  id: v.string(),
  name: v.string(),
  price: v.number(),
  inStock: v.boolean()
});

type Product = InferStandardSchema<typeof productSchema>;
// type Product = {
//   id: string;
//   name: string;
//   price: number;
//   inStock: boolean;
// }
```

## Composable Schemas

Use `ComposableStandardSchema` and `InferComposableStandardSchema` to work with multiple schemas:

```typescript
import type {
  ComposableStandardSchema,
  InferComposableStandardSchema
} from '@geekmidas/schema';
import { z } from 'zod';

// Define multiple schemas
const schemas = {
  user: z.object({
    id: z.string(),
    email: z.string().email()
  }),
  post: z.object({
    id: z.string(),
    title: z.string(),
    authorId: z.string()
  }),
  comment: z.object({
    id: z.string(),
    content: z.string(),
    postId: z.string()
  })
} satisfies Record<string, ComposableStandardSchema>;

// Infer types from all schemas
type Schemas = InferComposableStandardSchema<typeof schemas>;
// type Schemas = {
//   user: { id: string; email: string };
//   post: { id: string; title: string; authorId: string };
//   comment: { id: string; content: string; postId: string };
// }

// Use individual types
type User = Schemas['user'];
type Post = Schemas['post'];
type Comment = Schemas['comment'];
```

## Generic Functions

Create generic functions that work with any StandardSchema:

```typescript
import type { InferStandardSchema } from '@geekmidas/schema';
import type { StandardSchemaV1 } from '@standard-schema/spec';

function validateData<T extends StandardSchemaV1>(
  schema: T,
  data: unknown
): InferStandardSchema<T> | null {
  const result = schema['~standard'].validate(data);

  if (result.issues) {
    console.error('Validation failed:', result.issues);
    return null;
  }

  return result.value as InferStandardSchema<T>;
}

// Usage with any schema
const userSchema = z.object({ name: z.string() });
const validatedUser = validateData(userSchema, { name: 'John' });
// validatedUser is typed as { name: string } | null
```

## Factory Pattern

Use composable schemas in factory patterns:

```typescript
import type {
  ComposableStandardSchema,
  InferComposableStandardSchema
} from '@geekmidas/schema';

class SchemaFactory<T extends Record<string, ComposableStandardSchema>> {
  constructor(private schemas: T) {}

  validate<K extends keyof T>(
    key: K,
    data: unknown
  ): InferComposableStandardSchema<T>[K] | null {
    const schema = this.schemas[key];
    if (!schema) return null;

    const result = schema['~standard'].validate(data);
    return result.issues ? null : result.value;
  }

  getSchema<K extends keyof T>(key: K): T[K] {
    return this.schemas[key];
  }
}

// Usage
const schemas = {
  user: z.object({ name: z.string() }),
  product: z.object({ sku: z.string(), price: z.number() })
};

const factory = new SchemaFactory(schemas);
const user = factory.validate('user', { name: 'John' });
// user is typed as { name: string } | null
```

## API Endpoint Validation

Common pattern for API endpoint validation:

```typescript
import type { InferStandardSchema } from '@geekmidas/schema';
import { z } from 'zod';

const createUserEndpoint = {
  body: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    age: z.number().int().min(18)
  }),
  response: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string()
  })
};

type CreateUserBody = InferStandardSchema<typeof createUserEndpoint.body>;
type CreateUserResponse = InferStandardSchema<typeof createUserEndpoint.response>;

async function createUser(
  data: CreateUserBody
): Promise<CreateUserResponse> {
  // Implementation with fully typed request and response
  return {
    id: '123',
    name: data.name,
    email: data.email
  };
}
```

## Type Guards

Create type guards using schema inference:

```typescript
import type { InferStandardSchema } from '@geekmidas/schema';
import { z } from 'zod';

const userSchema = z.object({
  id: z.string(),
  email: z.string().email()
});

type User = InferStandardSchema<typeof userSchema>;

function isUser(value: unknown): value is User {
  const result = userSchema.safeParse(value);
  return result.success;
}

// Usage
const data: unknown = { id: '123', email: 'user@example.com' };

if (isUser(data)) {
  // data is now typed as User
  console.log(data.email);
}
```

## Integration with @geekmidas/api

This package is used internally by `@geekmidas/api` for type-safe endpoint validation:

```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

// The API package uses InferStandardSchema internally
const endpoint = e
  .post('/users')
  .body(z.object({ name: z.string() }))
  .output(z.object({ id: z.string() }))
  .handle(async ({ body }) => {
    // body is automatically typed as { name: string }
    return { id: '123' };
  });
```

## Why Use This Package?

1. **Type Safety**: Ensures your types match your runtime validation schemas
2. **DRY Principle**: Define schemas once, derive types automatically
3. **Refactoring Safety**: Changing schemas automatically updates types
4. **Universal**: Works with any StandardSchema-compatible library
5. **Zero Cost**: Pure TypeScript types with no runtime overhead

## Supported Validation Libraries

Any library implementing the StandardSchema specification, including:

- [Zod](https://github.com/colinhacks/zod)
- [Valibot](https://github.com/fabian-hiller/valibot)
- [ArkType](https://github.com/arktypeio/arktype)
- And any future StandardSchema-compatible library

## TypeScript Configuration

Requires TypeScript 5.0 or higher with strict mode enabled:

```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true
  }
}
```

## Related Packages

- [@geekmidas/api](../api) - Uses this package for endpoint validation
- [@geekmidas/envkit](../envkit) - Environment configuration with schema validation
- [@standard-schema/spec](https://github.com/standard-schema/standard-schema) - StandardSchema specification

## License

MIT
