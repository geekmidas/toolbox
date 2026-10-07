---
'@geekmidas/constructs': minor
---

:boom: `.dependsOn([auth])` outside the auth app now yields an HTTP client, not the server

- **`BetterAuth.service` is an `AuthClient`.** A handler's `services.auth` used to be the Better Auth server itself, built in whichever process asked: it read `AUTH_SECRET`, opened the auth tenant and wired the mailer, so an API that only checked sessions crashed wherever it was (rightly) not given the auth app's secret. It is now `{ api: { getSession({ headers }) } }`, which asks `GET <AUTH_URL><basePath>/get-session` with the request's `cookie`, `authorization` and `x-forwarded-for`, and answers Better Auth's `{ user, session }` or `null` (for a `null` body or a 401). A failure answer throws `SessionCheckFailed`; a server it cannot reach throws the new `AuthServerUnreachable`. `getSession` is the one call the client makes — other server `api` calls belong to the auth app.
- **The server is only `auth.server()`**, which the auth app's generated entry calls, and which now also returns the better-auth instance as `auth`. Which one a process holds follows from how it reaches the construct, not from where it runs.
- `verify()` — what a surface's `.auth(auth)` calls — is the same request, and also reads a 401 as signed out.
- better-auth is imported only when the server is built, so a process holding the client never loads it to get one.
- **The Hono adaptor loads `@geekmidas/audit`, `@geekmidas/rate-limit` and `@geekmidas/db/rls` only for an endpoint that uses them.** They are optional peers, but the adaptor imported them at the top, so an app without them could not bundle a production server (or start `gkm dev`). A missing one now fails the request that needs it with `OptionalPeerMissing`, naming the package.
- An endpoint's error answer no longer carries the stack outside `gkm dev` (`NODE_ENV=development`), and a 5xx no longer carries the error it wrapped (`details.originalError` — a missing variable's name, a failed query). Both go to the log, which the adaptor now writes under `err`, so a ZodError is serialized with its stack instead of being spread into the line.
- Errors are logged under `err` rather than `error` (database pool, subscriber, Lambda and SNS adaptors), so a pino logger serializes them.
