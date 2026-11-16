---
'@geekmidas/cli': minor
---

:sparkles: Point-in-time recovery for a compose stage's Postgres (#456)

A stage's backups entry takes `pitr: true` — or
`pitr: { keep: '14d', base: '1d' }` — and its stack's Postgres is built with
WAL-G and archives its WAL every minute,
while the `backups` service takes a base backup on the `base` schedule from the
data volume, mounted read-only. Both are encrypted with `PITR_KEY`, a stage
secret the deploy generates once, and kept in the project bucket under
`backups/pitr/`; the stage's key stays put-only, and the bucket's lifecycle
expires base backups after `keep` and WAL one base interval later.

`gkm backup:restore --to <time>` brings the whole cluster back to that second —
a fresh base backup first, then the stack stopped while the recovered cluster
is swapped in — and `--into <name>` restores beside the live one instead, as
`<name>_<database>`, for inspection or the monthly restore drill.
`gkm backup:list` shows the restore window, `gkm backup:now --base` takes a
base backup, and the `backups` container is unhealthy when `archive_command`
fails, a WAL segment waits more than five minutes, or the last base backup is
too old.
