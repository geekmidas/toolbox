---
'@geekmidas/constructs': minor
'@geekmidas/schema': minor
'@geekmidas/cli': minor
---

An endpoint has a summary, can be deprecated and carry `x-` extensions; a surface describes its tags

`.summary()`, `.deprecated()` and `.extensions({ 'x-…': … })` on the builder
are written onto the endpoint's operation, and onto its JSDoc in the
generated client — `@deprecated` included. A key that is not `x-` throws
`NotAnExtension`.

`new RestApi(id, { openapi: { title, version, tags } })` says what the
document says about the API as a whole. Tags are listed with their
descriptions in the order declared, then any an endpoint names that were not.
A document with no title is titled after its surface's id rather than `API`,
and the generated server no longer hard-codes `API Documentation` over it.
