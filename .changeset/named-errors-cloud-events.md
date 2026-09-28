---
'@geekmidas/cloud': patch
'@geekmidas/events': patch
---

Cloud and events failures are named errors, and a Dokploy failure during a deploy says what failed

Every bare `throw new Error` in `@geekmidas/cloud` and `@geekmidas/events` is a
named class now, matched by class rather than message text:

- `@geekmidas/cloud`: `DokployCallFailed` (a Dokploy API call answered with an
  error status: `path`, `status`, `statusText`, `detail`) and
  `RoutesMissingEnvironment` (routes reading variables nothing links).
- `@geekmidas/events`: `UnsupportedEventTransport` (every factory, for a
  scheme or connection nothing implements), `SnsQueueMissing`,
  `SqsBatchPartlyFailed` (with the refused entries), `RabbitMQChannelUnavailable`
  and `PgBossNotStarted`.

The Dokploy provider is serialised into Pulumi state, and serialisation turned
its error into an object with no message, no stack and no `Error` prototype —
so a failed Dokploy call during a deploy reported nothing at all. The class now
sets its message and stack itself and says how to print itself, and a test runs
the serialised provider to keep that true. Whether a delete found the
application already gone is decided by the status, not by matching "404" in a
message.
