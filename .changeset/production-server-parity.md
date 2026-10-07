---
'@geekmidas/cli': minor
---

A production server serves endpoints the way `gkm dev` does

- **One handler path.** `gkm build --production` generated its own per-tier handlers (`minimal`, `standard`, `full`), hand copies of the adaptor that had drifted from it: an endpoint from an `.auditor(...)` router was handed `auditor: undefined`, so `auditor.audit(...)` threw; cookies and headers a handler set were dropped; `res.status(...)` threw on a minimal endpoint; query arrays and output-validation status differed. Every endpoint is now registered with `HonoEndpoint`, as under `gkm dev` and in a feature test. The tier analyzer, the templates and the internal `optimizedHandlers` flag are gone.
- **Errors are logged with their message and stack.** The generated entries (server, crons, queues, subscribers, shutdown hooks) logged `{ error }`, which pino writes as `"error":{}`; they log `{ err: error }`.
- **An app that calls a surface is given its URL and nothing else.** The API's environment held the auth server's `AUTH_TRUSTED_ORIGINS` and `AUTH_COOKIE_DOMAIN` along with `AUTH_URL`; those are the surface's own settings. Its secret, tenant URL and mail keys were already the auth app's alone.
- **An app that uses a file server's bucket is given the file server's URL.** `.dependsOn([uploads])` points at the bucket node, so the API got `UPLOADS_URL` but not `UPLOADS_SERVER_URL`, which the client reads: every `POST /uploads` in a `gkm compose` stack answered 500.
- **A minified bundle keeps its names** (`--keep-names`), so an error's `type` in a log line and `name` in a response read `UnauthorizedError` rather than `_6`.
