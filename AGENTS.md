# Agent conventions

Rules for anyone — human or agent — writing code in this repository. The stack,
layout, and architectural patterns live in [CLAUDE.md](./CLAUDE.md); this file is
for conventions that are easy to get wrong and cheap to state.

## Validation schemas (Zod)

**Use Zod's top-level format validators. Never chain a format onto
`z.string()`.**

```ts
// yes
z.email()
z.url()
z.uuid()

// no
z.string().email()
z.string().url()
z.string().uuid()
```

Zod 4 moved the formats out of `ZodString`, where they were methods on a type
they did not belong to, and made each one a schema in its own right. The chained
form is deprecated: it still runs, but it types as a `ZodString` carrying a
check, so a format cannot be composed, extended, or narrowed the way a schema
can. Emitted JSON Schema and OpenAPI also differ between the two, and an API's
published contract should not depend on which spelling someone reached for.

This applies everywhere Zod is used — endpoint bodies, outputs, params, queue
and topic payloads, tests, benchmarks, docs, and the templates `gkm init`
scaffolds.

**Not affected:** `@geekmidas/envkit`'s parser has its own builder, and
`get('ADMIN_EMAIL').string().email()` is that API rather than Zod's. Leave it
alone.
