# OpenAPI Components Support

The `@geekmidas/api` package now supports extracting reusable schemas to the OpenAPI components section. This allows for better schema reuse and cleaner API documentation.

## How it Works

When you add metadata to your Zod schemas using the internal `_def.meta` property, the OpenAPI generator will automatically extract these schemas to the components section and use `$ref` references instead of inline schemas.

## Example

```typescript
import { z } from 'zod/v4';
import { Endpoint } from '@geekmidas/api/server';

// Define a reusable schema with metadata
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

// Add metadata to make it a component
// Note: This uses internal Zod API and may change in future versions
(UserSchema as any)._def.meta = { id: 'User' };

// Use the schema in endpoints
const getUserEndpoint = new Endpoint({
  route: '/users/:id',
  method: 'GET',
  output: UserSchema, // Will use $ref: '#/components/schemas/User'
  // ... other options
});

// Generate OpenAPI spec
const openApiSpec = await Endpoint.buildOpenApiSchema([getUserEndpoint]);

// Result includes components:
// {
//   openapi: '3.0.0',
//   paths: {
//     '/users/{id}': {
//       get: {
//         responses: {
//           '200': {
//             content: {
//               'application/json': {
//                 schema: { $ref: '#/components/schemas/User' }
//               }
//             }
//           }
//         }
//       }
//     }
//   },
//   components: {
//     schemas: {
//       User: {
//         type: 'object',
//         properties: {
//           id: { type: 'string' },
//           name: { type: 'string' },
//           email: { type: 'string', format: 'email' }
//         },
//         required: ['id', 'name', 'email']
//       }
//     }
//   }
// }
```

## Benefits

1. **Reduced Duplication**: Schemas used in multiple endpoints are defined once in components
2. **Cleaner Documentation**: OpenAPI docs show clear schema references
3. **Better Type Safety**: Reusable schemas ensure consistency across endpoints
4. **Smaller API Specs**: References are more compact than inline schemas

## Implementation Details

The implementation consists of:

1. **Component Collector**: Tracks schemas with metadata during OpenAPI generation
2. **Schema Metadata Extraction**: `getSchemaMetadata` extracts the `id` from schema metadata
3. **Schema Conversion**: `convertSchemaWithComponents` handles both inline schemas and component references
4. **Automatic Registration**: Schemas with metadata are automatically registered as components

## Limitations

- Currently only supports Zod schemas with manually added metadata
- Uses internal Zod API (`_def.meta`) which may change in future versions
- Metadata must include an `id` field for the component name