---
'@geekmidas/cli': patch
---

`gkm init --template worker` produced a project that did not compile

Three faults, in a template described as "Background job processing":

It scaffolded `src/crons/cleanup.ts` importing `{ cron }` from
`@geekmidas/constructs/crons` — an export that does not exist. The generated
project failed to resolve on first build.

It declared a `RestApi` with no endpoints on it: an HTTP surface, in a project
whose premise is that nothing calls it over HTTP. A surface was the only
construct that made an app exist and the only way to get a logger into the
generated runtime, so one was written for that reason alone. It is built from
`Worker` now — no authorizer, no address, and its factories carry its logger,
so a subscriber file opens with what it subscribes to.

Its subscriber destructured `event` where the handler is passed `events`, a
batch. Both transports deliver in batches.

It also scaffolds no cron any more. `CronGenerator` emits handlers for
`aws-lambda` only and `.gkm/server/` has no crons file, so a scheduled job on a
server target deploys nothing at all — an example that teaches a feature which
silently does not happen is worse than no example. Subscribers and queues do
have a server runtime, and are what the template teaches until there is a
scheduler to run a cron.

`apps/example` is removed in the same change: it still declared `routes`,
`envParser` and `logger`, a config shape v10 does not read, and nothing
typechecked it because `apps/` is absent from the root tsconfig's references.
