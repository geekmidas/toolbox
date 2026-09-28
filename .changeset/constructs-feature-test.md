---
'@geekmidas/constructs': minor
'@geekmidas/cli': patch
---

`featureTest`: drive an app the way it runs deployed

`@geekmidas/constructs/testing` gains `featureTest`: a browser signs in and calls
the API, the API asks the auth server who is calling, each over its URL, and
every database is in its own transaction, rolled back after the test.

- Each surface's endpoints and each `BetterAuth` server are served in-process
  through MSW, from the real handler, for the test a request was made for —
  found from the `x-test-context-id` header, including on a request the code
  under test made while handling another.
- Each database construct — the app's and each schema tenant — resolves, inside
  a test, to that test's own transaction on its own connection.
- Fixtures: `browser` (already the global `fetch`), `db`, `mailbox(address)`.
- A request belonging to no running test is refused (`UnknownTestContext`).

`gkm test` and `gkm dev` publish `<ID>_INBOX_URL` beside an `Email` construct's
URL: Mailpit's inbox, where the mail it sent is read back. Local only.

`@geekmidas/testkit` is an optional peer of `@geekmidas/constructs`, needed by
`./testing` alone.

Part 3b of #77.
