---
'@geekmidas/constructs': minor
'@geekmidas/client': minor
'@geekmidas/cli': minor
---

An endpoint documents every response it answers: `.response(status, content)`

A handler could answer another status with `response.status()`, but the
document named one status and one content type. `.response(status, content,
{ description })` declares another beside the default `.output()`/`.status()`/
`.responseType()` — repeatable. `content` is a schema (JSON) or a schema per
content type (`{ 'application/json': Report, 'text/csv': z.string(),
'application/pdf': binary() }`); `binary()` declares an opaque body.

- **Document:** each status and content type appears under the operation's
  `responses`.
- **Runtime:** a body answered with a declared status is checked against that
  response, not `.output()`, in the content type the handler set with
  `response.header('content-type', …)` or the first listed. A content type
  other than JSON is emitted as-is; on API Gateway, bytes are base64-encoded.
  One the response does not list fails with `UndeclaredResponseContentType`.
  Declared events and audits follow `.output()` and are not sent for another
  status.
- **Client:** the handler may return any declared body; the generated client
  and `InferOpenApi` type each status and content type, and a call resolves to
  the union of every 2xx JSON body rather than only the 200's (or the 201's).
  The generated client also types `.output()` under the status it answers
  rather than always 200.
