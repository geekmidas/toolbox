---
'@geekmidas/testkit': minor
'@geekmidas/constructs': patch
---

:bug: Each test's browser connects from its own address, and a session check carries the client's

- **`Browser` has an `address`** — a fresh private one by default, or `new Browser({ address })` — sent as `x-forwarded-for` on its requests, the way a proxy in front of the app adds it. Each browser is a different person on a different connection. Without it every test was the same client to Better Auth (`127.0.0.1` in tests), so its rate limit counted every test in one row: concurrent tests queued on each other's uncommitted inserts into `rateLimit` until they ended — sign-ins refused and timeouts, more of them the bigger the suite. A request that sets the header itself keeps its own.
- **A surface's session check forwards `x-forwarded-for`** with the session headers. Better Auth rate-limits `/get-session` too, by client; without the address every user's session check came from the surface itself — one shared bucket, so enough traffic from anyone turned session checks into 429s (`SessionCheckFailed`).
