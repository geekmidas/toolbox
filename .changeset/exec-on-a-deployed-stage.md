---
'@geekmidas/cli': minor
---

`gkm exec --stage <stage>` runs a command against a deployed compose stage

A one-off script (a data import, a backfill, a report) can now run from a
laptop or CI as an app runs on a deployed stage:

```bash
cd apps/api
gkm exec --stage production -- node scripts/backfill.ts
```

- The environment is the app's container's, derived the way the deploy
  derives it from the stage's secrets, read from the stage's store
  (`--profile` names the AWS profile for it).
- Each service it names that the server publishes on its loopback (Postgres,
  MinIO) goes through an SSH tunnel on the deploy's login, the same tunnel the
  deploy migrates through. A sibling app is reached at its public address.
- Nothing is written to disk. The values exist only in the command's
  environment, and `Credentials` is filled from there.
- The tunnels close when the command exits, whether it succeeds, fails or is
  interrupted. `gkm exec` exits with the command's code.
- A protected stage asks first. `--yes` skips the question.
