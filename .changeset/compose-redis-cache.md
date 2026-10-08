---
'@geekmidas/cli': minor
---

`gkm compose` keeps every cache in a Redis of its own

A workspace that declares a cache now gets a Redis in its compose stack, on
every stage, local and deployed — and every cache lives in it, one declared
from a database (`database.cache('Sessions')`) included. Until now a stack
kept the cache in a Postgres table, competing with the app for the database's
connections.

The service is `redis:8-alpine` (reconcile's pin), on the compose network only
with no published port, bounded at `maxmemory 256mb` with `allkeys-lru`,
persisted to an append-only file on the `redis-data` volume (kept by
`--down`), health-checked and log-rotated. A deployed stage's password is
generated on the first run and kept in its secrets as `REDIS_PASSWORD`, read
back on every later run; the local stage uses a fixed one. The password is in
`redis.env` (`0600`), never in the compose file, the server's command line or
the health check.

Each backend and worker that reads a cache gets its URL —
`SESSIONS_URL=redis://:<password>@redis:6379/0`, a logical database per cache
— and each image is built with `gkm build --cache redis`, so its entry
registers the Redis cache driver (`redis://` and `rediss://`) rather than the
Postgres one. The project needs `ioredis`; a build without it stops with
`RedisClientMissing` before anything is touched. No cache table is created.

A cache whose URL the stage's secrets set — a managed Redis — is used as
given, and a stack whose every cache is set that way runs no Redis.

`gkm dev`, `gkm test` and Dokploy are unchanged: they keep the target's
default, a table in the declared database on a server target.
