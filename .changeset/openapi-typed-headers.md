---
'@geekmidas/constructs': minor
'@geekmidas/schema': minor
'@geekmidas/cli': minor
'@geekmidas/client': minor
---

Request headers are typed and validated, and response headers are documented

`.headers()` declares the request headers an endpoint reads — an object
schema with lower-case keys, or headers one by one, each a schema or a shared
`defineHeader()`. Incoming names are lower-cased, the headers are validated
on Hono, API Gateway and in a test, and the handler and authorizer read them
as `headers`, typed. A missing required header, or one its schema refuses,
is answered with 400 (`RequestHeadersInvalid`). They are documented as
`in: header` parameters, and the generated client writes them as
`parameters.header` and requires `headers` when one is required, still
taking any other header.

`.responseHeaders({ ETag, Location: { schema, description } })` documents
the headers a successful response carries under that response's `headers`,
and in the generated `paths`. A `defineHeader()` is written once, under
`components.parameters` or `components.headers`, and referred to with `$ref`.
Headers such as `Idempotency-Key`, `If-Match`, `ETag`, `Location` and
`Retry-After` used to be invisible to the document and the client.
