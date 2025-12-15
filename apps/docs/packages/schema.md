# @geekmidas/schema

Type utilities for StandardSchema-compatible validation libraries.

## Installation

```bash
pnpm add @geekmidas/schema
```

## Features

- Type inference helpers for StandardSchema
- ComposableStandardSchema type for nested schemas
- Works with any StandardSchema-compatible library (Zod, Valibot, etc.)
- Schema to JSON Schema conversion utilities
- Zero runtime overhead

## Package Exports

- `/` - Core StandardSchema type utilities
- `/conversion` - Schema conversion utilities
- `/openapi` - OpenAPI schema generation
- `/parser` - Schema parsing utilities

## Basic Usage

### Type Inference

```typescript
import type { InferStandardSchema } from '@geekmidas/schema';
import { z } from 'zod';

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

// Infer type from schema
type User = InferStandardSchema<typeof userSchema>;
// { id: string; name: string; email: string }
```

### Composable Schemas

```typescript
import type { ComposableStandardSchema } from '@geekmidas/schema';
import { z } from 'zod';

const schemas: ComposableStandardSchema = {
  user: z.object({
    id: z.string(),
    email: z.string().email(),
  }),
  post: z.object({
    id: z.string(),
    title: z.string(),
    authorId: z.string(),
  }),
  comment: z.object({
    id: z.string(),
    content: z.string(),
    postId: z.string(),
  }),
};
```

### Schema Validation

```typescript
import { parseSchema } from '@geekmidas/schema/parser';
import { z } from 'zod';

const schema = z.object({ name: z.string() });

const result = parseSchema(schema, { name: 'John' });
if (result.success) {
  console.log(result.data); // { name: 'John' }
} else {
  console.log(result.issues); // Validation errors
}
```

### OpenAPI Generation

```typescript
import { schemaToOpenApi } from '@geekmidas/schema/openapi';
import { z } from 'zod';

const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).optional(),
});

const openApiSchema = schemaToOpenApi(userSchema);
// {
//   type: 'object',
//   properties: {
//     id: { type: 'string', format: 'uuid' },
//     name: { type: 'string', minLength: 1, maxLength: 100 },
//     email: { type: 'string', format: 'email' },
//     age: { type: 'integer', minimum: 0 },
//   },
//   required: ['id', 'name', 'email'],
// }
```

## StandardSchema Compatibility

Works with any StandardSchema-compatible validation library:

- **Zod** - `z.object(...)`
- **Valibot** - `v.object(...)`
- **ArkType** - `type({...})`
- **Typebox** - `Type.Object(...)`
