---
'@geekmidas/cli': minor
---

`gkm db:tunnel --stage <stage> [construct]` opens an SSH tunnel to a deployed
compose stage's Postgres and prints each database's owner URL through it, password
included, until Ctrl-C. Until now a deployed stage's database password was never
shown anywhere, so a SQL client couldn't sign in to it.
