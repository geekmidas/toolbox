---
'@geekmidas/constructs': minor
'@geekmidas/services': minor
'@geekmidas/cli': patch
---

Database connections say who holds them, and queries say what ran them

- **`application_name` on every connection** — the Lambda function's name, or the surface's id on a server (`GKM_APP_NAME`, set by the generated entry), or the app under `gkm dev`. A fallback: `PGAPPNAME` or `?application_name=` in the URL still win. `pg_stat_activity` can now say which function or app is holding connections.
- **Query tags.** A query run inside an endpoint, subscriber, queue or cron ends in a sqlcommenter comment, `/*operation='POST /orders',request_id='…'*/`, visible in `pg_stat_activity` and the server's logs. `pg_stat_statements` ignores it. Off with `new KyselyDatabase(id, { queryTags: false })`.
- **An idle connection ended by the server no longer crashes the process.** Pools had no `'error'` listener, so `idle_session_timeout` or a failover surfaced as an uncaught exception.
- **Production servers close their pools on shutdown.** On `SIGTERM` the server stops taking requests, lets in-flight ones finish, and runs `runShutdownHooks()` (new, from `@geekmidas/constructs`) before exiting, instead of waiting 30s with every connection still open. It exits by `GKM_SHUTDOWN_TIMEOUT_MS` (8s by default, under Docker's 10s stop timeout), with code 1 if it had to cut a request off.
- `@geekmidas/services`: the request context carries the `operation` it is for; `currentRequestContext()` reads it without throwing outside a request.
