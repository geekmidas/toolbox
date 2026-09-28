---
'@geekmidas/cli': patch
'@geekmidas/cloud': patch
---

Delete the `services` block from `gkm.config`. Whether a resource exists is its
construct; which backend serves it follows the deploy target (cache: a table on
a server, Upstash on AWS; events: pg-boss on a server, SNS/SQS on AWS; storage:
MinIO / S3); mail is whatever `MAIL_URL` names. The config schema is now strict,
so a leftover `services` key — or any unknown key — fails to load instead of
being ignored.

Compose is now two files. `docker-compose.constructs.yml`, at the project root,
is generated from the construct plan by `gkm dev`, `gkm test`, `gkm setup` and
`gkm docker`, and is gitignored. The project's own `docker-compose.yml` is
merged over it (`-f docker-compose.constructs.yml -f docker-compose.yml`), so
image pins and extra services live there. `gkm docker` puts each app in the
same file behind the `apps` profile, wired to every construct's own keys
(`ORDERS_URL`, a schema tenant's URL) instead of a hardcoded `DATABASE_URL` /
`REDIS_URL`. `docker.compose.services`, `generateDockerCompose` and
`generateMinimalDockerCompose` are gone.

`gkm init` asks which constructs to declare instead of which services to run,
and writes no compose file. `trustLocalCa` is gone from the config: trusting
the local CA is per machine — `gkm trust`, or `gkm setup --yes`.

Migrating: delete `services` from `gkm.config.ts` and `docker.compose` from any
app config; move image pins into a `docker-compose.yml`; add
`docker-compose.constructs.yml` to `.gitignore`.
