---
'@geekmidas/client': minor
'@geekmidas/constructs': patch
---

Typed method calls: `api.post('/users', { body })`

Every client — `createTypedFetcher`, `createAuthAwareFetcher`, and so the
generated `createApi` — now answers by method as well as by
`api('POST /users', …)`: `api.get`, `post`, `put`, `patch`, `delete`, `options`.
The route autocompletes per method (only routes with a `POST` appear in
`api.post`), the second argument has only the keys the endpoint declares, and it
is required exactly when something in it is.

Three typing fixes came out of testing it, and apply to `api('…')` too:

- **Routes declared with `:param` were uncallable.** `InferOpenApi` keyed them by
  the declared form (`/users/:id`) instead of the served one (`/users/{id}`), so
  no path parameter was inferred and the documented `api('GET /users/{id}')` did
  not typecheck against an endpoint declared that way. Paths are now keyed with
  `ConvertRouteParams`, which `@geekmidas/constructs/endpoints` now exports.
- **A GET accepted any body.** An absent body is `requestBody?: never`, which
  matched `{ content?: … }` with the body inferred as `unknown`.
- **A required query was optional.** `query` was always optional and never made
  the argument required; now a query with a required key is required, and so is
  the argument.
