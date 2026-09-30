---
'@geekmidas/constructs': patch
---

A publisher derived from a topic or queue is an edge to it

`.publisher(users.publisher)` took a plain service, so the endpoint, cron or
function it was given to recorded no edge to the `users` topic — unlike
`.database()` or `.dependsOn()`. The app's environment is composed from its
edges, so kitchen-sink's API container was generated without
`USERS_PUBLISHER_CONNECTION_STRING` while its handlers publish to `users`.

`Topic#publisher` and `Queue#publisher` are marked with the construct they
stand for (`derivedFrom`), and every publishing builder's `.publisher()`
records that id (`edgesWith`), the way `.database()` does. A subscriber's
`.publisher()` is a binding, not a dependency, and records nothing.
