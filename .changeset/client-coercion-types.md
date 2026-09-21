---
'@geekmidas/client': patch
---

A coercing schema no longer rejects what it coerces

`z.coerce.number()` accepts `'100'` and produces `100`. The handler is
downstream of parsing, so it reads a number; the client is upstream, so it
sends the string. The generated client types took both from the schema's
**output**, and so demanded the parsed type of a request that had not been sent
yet — rejecting at compile time exactly what the endpoint accepts at runtime.

Query parameters made it plainest. A query string is text on the wire, always,
so a coerced query parameter asked callers for a number that cannot be put in a
URL.

`requestBody` and `parameters.query` are now typed from the schema's input.
Responses are unchanged: those are read rather than sent, so the parsed type is
the right one. For a schema that coerces nothing the two are identical, so this
costs nothing where it does not matter.

Type tests now run. `tsconfig.json` excludes `src/__tests__/**`, so every
`expectTypeOf` in the package compiled to nothing and passed for that reason —
this bug sat behind those assertions the whole time. `*.test-d.ts` files are
compiled under `typecheck` and their errors reported as failures.
