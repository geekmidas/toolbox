---
'@geekmidas/cli': patch
---

:bug: `gkm compose` seeds see what `gkm seed` hands them

A seed run by `gkm compose` was given only the Postgres URLs: no stored secrets,
and no bucket, so one that uploaded through a `FileServer` failed on
`ASSETS_URL` / `ASSETS_SERVER_URL`. Every command now merges a stage's secrets
under what it resolves through one `stageEnv`, and compose resolves with the
stack's own inputs — each loopback service it reaches (Postgres and MinIO), its
logins, and each app's and file server's public address. A key the stage set by
hand stays what its apps are given. The buckets are created before the seeds
run.
