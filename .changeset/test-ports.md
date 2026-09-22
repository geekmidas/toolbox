---
'@geekmidas/testkit': patch
---

A port conflict no longer costs the whole test run

Only Postgres had an overridable host port. Every other service in
`docker-compose.yml` was fixed, so a developer with another project's Redis on
6379 could not run this suite — and not in the sense of losing a few tests: a
`globalSetup` that cannot start its container aborts collection, so vitest
reports *no tests*, which reads exactly like a suite that passed.

Every host port is now overridable, under the names `gkm init` already
generates for scaffolded projects (`REDIS_HOST_PORT`, `SRH_HOST_PORT`,
`MINIO_API_HOST_PORT`, …). The suites read the same variables through one
module, so they connect to wherever the container was actually published —
including `HonoEndpointAdaptor.pgboss-publisher.spec.ts`, which hardcoded 5432
and so tested against whichever project happened to own it.
