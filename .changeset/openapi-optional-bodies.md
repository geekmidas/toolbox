---
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
'@geekmidas/client': minor
---

An optional request body is documented, and accepted, as optional

A `.body()` schema that accepts `undefined` — `z.object({…}).optional()` —
is now `requestBody.required: false` in the OpenAPI document and an optional
`requestBody?` in the generated `paths`, so the client lets a caller leave
`body` out. A Hono server hands such an endpoint `undefined` when the request
sends no body, where it used to hand the schema `{}` and refuse it for the
fields an empty object lacks. Every body used to be documented as required.
