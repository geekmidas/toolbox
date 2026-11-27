---
'@geekmidas/constructs': minor
'@geekmidas/cli': patch
'@geekmidas/errors': patch
---

An endpoint documents its refusals, and can answer them as RFC 9457 problem details

- **`.error(status, code, { description?, details? })`** on an endpoint, and
  on a branch (`api.session(…).error(401, 'SIGNED_OUT')`), declares a refusal.
  The OpenAPI document lists each status under `responses`. Its body is
  `application/problem+json`: `allOf` a shared `Problem` component, with
  `code` narrowed to the codes declared for that status.
- **`new RestApi('Api', { errors: 'problem' })`** answers every failure, on
  Hono and on API Gateway, as `application/problem+json`:
  `{ type, title, status, detail, code, details }`. A request that its input
  schemas reject is a 422 `VALIDATION_FAILED`, with the issues as its
  `details`. A 5xx keeps its `details` out of the response outside `gkm dev`.
  Without the option, a surface answers with the body it always has.
- **The generated client** types each declared status under `responses`.
- **`createHttpError(409, msg, { code })`** keeps the `code` and the `cause`.
  Before, the subclasses it builds dropped both. `412`, `413` and `415` now
  have their reason phrases.
