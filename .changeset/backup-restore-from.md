---
'@geekmidas/cli': minor
---

:sparkles: **`gkm backup:restore --from imports/<file> --database <name>` loads a prepared import into a compose stage.**
A database moved onto a compose stage — from RDS, another host, an older
layout — is prepared offline as a gzipped, data-only SQL file, uploaded to the
stage's own backups prefix under `imports/`, and loaded between the first
deploy and the next:

```bash
gkm backup:restore --stage production --from imports/app.sql.gz --database database
```

`--from` stands in for `--at`/`--latest` (`BackupRunNotChosen` for more than
one), is relative to the stage's backups prefix and must name a `.sql.gz` in
`imports/` (`ImportPathInvalid` for `..`, absolute paths and URLs), and needs
`--database` (`ImportNeedsDatabase`). Like any restore it asks and takes a
fresh backup first. A data-only file has to run connected to the database
itself, so instead of closing the database to connections it stops the stack's
containers but its infrastructure (Postgres, the backups container, the proxy
and the stack's other services), ends any other session on the database, runs
the file in one transaction (`psql --single-transaction -v ON_ERROR_STOP=1`)
and starts the stopped containers again, whether the load worked or not
(`AppsNotRestarted` names any that would not start).

`gkm backup:list` shows `imports/` in a section of its own, and `--json` now
prints `{ "runs": [...], "imports": [...] }`. `--latest` never picks an import,
and the stage's backup expiry no longer applies to it: its lifecycle rule
matches the run folders (`backups/2…`) instead of the whole prefix, so the next
deploy rewrites each stage's rule.
