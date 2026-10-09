---
'@geekmidas/cli': minor
---

Backups for every deployed compose stage with Postgres

A deployed compose stage whose stack runs Postgres is now backed up by
default: every day at 02:00 UTC, kept 30 days, into the project bucket under
`gkm/<project>/<stage>/backups/<day>/<time>/<database>.sql.gz`.
`deploy.backups.<stage>` takes `{ every, keep }`, `{ cron, keep }` or `false`;
an interval under an hour is refused by name.

The deploy creates the IAM user `gkm-<project>-<stage>-backups`, allowed only
`s3:PutObject` under that prefix, and writes its key into the stage's secrets
as `BACKUPS_URL`; `--rotate-keys` and `--retire-old-keys` cover it, and
`gkm deploy:github` grants the role what it takes. The project bucket's
lifecycle expires each stage's backups, rebuilt from every stage's config.
The stack runs a `backups` service built from its own Postgres image, signing
in with a read-only role and healthy only while its last run is recent.

`gkm backup:list`, `gkm backup:now` and `gkm backup:restore` list, take and
restore backups — a restore asks first and takes a fresh backup.

Dokploy's backup destination moved from `deploy.backups` to
`deploy.dokploy.backups`.
