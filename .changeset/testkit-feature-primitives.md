---
'@geekmidas/testkit': minor
---

Feature test primitives: `Browser`, `createMailbox`, test context, `TransactionRegistry`

The pieces a feature test is built from, none of which knows about constructs
(the wiring that does lives in `@geekmidas/constructs/testing`):

- `@geekmidas/testkit/browser` — `Browser`: a `fetch` with a cookie jar that
  follows the browser's rules, following redirects hop by hop, installable as
  the global `fetch`. On the server side of a test it never lends its cookies,
  so a server that forgets to forward one is caught rather than covered for.
- `@geekmidas/testkit/mailbox` — `createMailbox`: reads the mail an app sent
  from Mailpit's HTTP API, waiting for it to arrive; one address per test.
- `@geekmidas/testkit/context` — the test a request belongs to, carried in an
  `AsyncLocalStorage` and stamped onto outgoing requests as `x-test-context-id`.
- `@geekmidas/testkit/transactions` — one transaction per database per test, on
  its own connection as deployed, rolled back together; code under test may use
  transactions itself, which become savepoints.

Part 3 of #77.
