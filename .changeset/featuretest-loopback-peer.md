---
'@geekmidas/testkit': patch
'@geekmidas/constructs': patch
'@geekmidas/cli': patch
---

:bug: A feature test's session checks keep each browser's address again

- **In-process requests present a loopback peer.** `featureTest` hands each request to a surface's or auth server's Hono app with no socket, so the auth server, which only believes `x-gkm-client-ip` from an internal caller, dropped it, and every session check in every test counted against one `rateLimit` row. Two checks in one test raced to insert it, and one aborted the test's transaction. Tests running at the same time queued on each other's uncommitted rows until they timed out. `featureTest` and `createMswHandlers` now dispatch with the bindings `@hono/node-server` gives a request from this machine (`incoming.socket.remoteAddress = '127.0.0.1'`), exported as `inProcessBindings()` from `@geekmidas/constructs/testing`. The browser's `x-forwarded-for` still marks its own requests as outside traffic, and the API's session check passes that address on as `x-gkm-client-ip`, intact. A request with no peer outside a test, such as on Lambda or Bun, is still not an internal caller.
- **A failed statement in a test fails alone.** Outside a transaction, the bound test connection now wraps each statement in a savepoint. A duplicate key from two concurrent requests then fails only that insert, as it would deployed, instead of aborting everything after it in the test. Better Auth's rate limiter depends on this behaviour, so two parallel session checks from one browser in one test now succeed. Code that opens its own transaction behaves as before.
- **`gkm setup --stage <deployed>`** names the stage it is provisioning (`Provisioning the 'prod' stage (dry run)...`). It no longer says it is setting up the local environment.
