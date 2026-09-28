---
'@geekmidas/schema': patch
'@geekmidas/constructs': patch
---

The OpenAPI document validates, and says who may call what

Checked against kitchen-sink with Redocly, swagger-parser and openapi-typescript:

- **A registered schema kept its definition.** A schema with `.meta({ id })`
  came out as `User: { $ref: '#/components/schemas/User' }` — a pointer to
  itself, so the document had no `User` and validators refused it. Zod 4.6
  already refers a registered schema to its `$defs` entry; that reference is no
  longer written over the definition.
- **OpenAPI 3.1.0**, not 3.0.0: the schemas are JSON Schema 2020-12
  (`type: ['string', 'null']`, `const`), which is 3.1's dialect. The
  per-schema `$schema` markers are dropped.
- **Security is documented.** An endpoint behind an authorizer gets a
  `security` requirement and its scheme in `components.securitySchemes`;
  before, every endpoint read as public. `RestApi`'s `authorizers: ['iam']`
  now resolves built-in names to their scheme, as the factory's own
  `.authorizers()` did.
- **The success status is the one the endpoint answers with**: `.status(201)`
  is documented as `201`, not `200`.
