---
'@geekmidas/services': minor
'@geekmidas/constructs': minor
---

A request knows who it is for: its logs, its services and its trace say so

When `auth.getSession()` verifies a session on a surface with `.auth(…)`, the
request is identified:

- **Context:** `serviceContext.getUser()` returns `{ id, sessionId }` for the rest
  of the request, across every `await`, and never in another request.
- **Logs:** the request's logger is rebound with `userId` and `sessionId`. Every
  line the handler logs carries them, and so does every line a service logs
  through `serviceContext.getLogger()`, including a service that captured the
  logger once for every request.
- **Trace:** the request's span gets OpenTelemetry's `enduser.id` and `session.id`,
  so its trace can be found by who made it.

Only ids are bound, never an email address. A session read another way can
identify the request with `identifyRequest` from `@geekmidas/services`.

Every adaptor now builds one logger per request, through one helper. It carries
`requestId`, `endpoint`, `route`, `method`, `host` and `path`, plus the Lambda and
API Gateway context on AWS. The handler, the request context and every service all
log through it. On API Gateway, a service's logs used to carry only the request
id; they now carry the route as well.
