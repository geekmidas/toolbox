---
'@geekmidas/constructs': minor
---

HTML form bodies and redirects for endpoints

An endpoint's body is now read by its `Content-Type` into the same `.body()`
schema, in one place every adaptor uses (`readRequestBody`):
`application/json` as before; `application/x-www-form-urlencoded` and
`multipart/form-data` as an object of fields — a repeated field, or one named
`field[]`, is an array, and a file part is a `File`; `text/*` as its text. Any
other type is answered `415` (`UnsupportedRequestContentType`), and malformed
JSON `400` (`MalformedRequestBody`). A Hono server (and so `gkm dev`, a built
server, `createMswHandlers` and `featureTest`) used to hand a form post to the
schema as `{}`.

On API Gateway, a form body used to reach the schema as its raw string; it is
now its fields, like everywhere else (`new URLSearchParams(body)` rebuilds the
string). A base64 body is decoded as bytes, so a multipart file survives. An
endpoint without a `.body()` schema no longer reads the body at all.

`response.redirect(url, status = 303)` sets `Location` and a 3xx and sends no
body; `.status()` and `response.status()` take a 3xx (`RedirectStatus`). A
redirect skips the `.output()` schema, and the declared events and audits that
are derived from the output. A handler may now return a value or a
`response.*` result from the same promise. `SuccessStatus`, `RedirectStatus`
and `EndpointStatus` are exported from `@geekmidas/constructs/endpoints`.
`TestEndpointAdaptor` answers with the endpoint's `.status()` when the handler
sets none, instead of 200.
