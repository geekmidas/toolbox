---
'@geekmidas/cli': patch
---

The scaffold writes no hand-rolled services

- A workspace API's `src/services/database.ts` (its own pool, its own snake_case
  copy of the schema) is gone. Its tests connect through the root database
  construct, and Studio builds its client from `database.clientConfig`.
- A workspace API's `src/services/auth.ts` (fetching `AUTH_URL` by hand) is
  gone. The router's session comes from the auth construct the API already
  names: `router.session(async ({ auth }) => auth.getSession())`.
- A worker's `src/events/` (a publisher service reading `RABBITMQ_URL`) is
  gone. It declares a topic in `src/constructs/topics.ts`, and its subscriber
  binds with `.topic(users)`.
