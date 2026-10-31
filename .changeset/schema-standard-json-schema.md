---
'@geekmidas/schema': minor
'@geekmidas/cli': patch
'@geekmidas/errors': patch
---

:boom: `@geekmidas/schema` converts to JSON Schema through Standard JSON Schema only

`convertStandardSchemaToJsonSchema` reads the schema's own
`~standard.jsonSchema.output({ target: 'draft-2020-12' })`, whatever its vendor,
and throws `SchemaHasNoJsonSchema` for a schema without it. `toJsonSchema` and
`hasJsonSchema` are exported for the raw schema with its `$defs`.

Removed: `StandardSchemaJsonSchema`, `SchemaVendor`, `VendorConvertor(s)`, and
the `zod-to-json-schema` and `@valibot/to-json-schema` peers. Their dynamic
`import()`s made every bundle resolve both converters, so `gkm build
--production` failed for an app that used neither. zod ≥ 4.2 needs nothing;
wrap a valibot schema in `toStandardJsonSchema(schema)` from
`@valibot/to-json-schema`.
