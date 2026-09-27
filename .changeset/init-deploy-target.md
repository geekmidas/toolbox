---
'@geekmidas/cli': patch
---

`gkm init` asks where the project deploys: Dokploy, AWS through SST, or later

AWS (SST) was missing from the choices. Picking it asks for the AWS region
and writes an `sst.config.ts` that hands the manifest `gkm build --provider
aws` writes to `@geekmidas/cloud`'s `fromManifest`, plus a `deploy` script,
`sst`, and the packages `@geekmidas/cloud/sst` imports. The database gets a
VPC, and a project that sends mail reads its SES sender from `MAIL_FROM`.

`--deploy <dokploy|sst|none>` and `--region` answer the questions without
prompting. `--yes` now picks no deploy target rather than Dokploy, and
`eu-west-1` when `--deploy sst` is given without a region.

**Stages are declared, not assumed.** `gkm.config.ts` now requires
`stages: { local, deployed, protected? }`, and every command reads it: `gkm
dev`, `exec`, `setup` and `test` run as `stages.local` (it was `development`,
after looking for `dev` secrets first), reconcile leaves only the local stage's
resources unsuffixed, and `gkm deploy --stage` refuses a stage that is not in
`deployed`. The config is checked: names fit a physical name, `test` is
reserved for `gkm test`, the local stage is never also deployed (they would
share secrets), and `protected` is a subset of `deployed`.

`gkm init` asks for them by name — the deployed stages, which one is
production, and the local stage (`--stages`, `--protected-stage`,
`--local-stage`) — and derives from them the local secrets it seeds, a
`deploy:<stage>` script per deployed stage, SST's retain/protect list, and the
scaffolded `STAGE` enum.

**Migrating:** add `stages` to `gkm.config.ts`. To keep existing local
secrets, name the local stage after the file they are in — `local:
'development'` for `.gkm/secrets/development.json` — or rename that file and
its key in `~/.gkm/<project>/` to the new name.

`gkm init` formats what it writes. It ran `biome format --write --unsafe`,
which Biome 2 rejects, and swallowed the error, so scaffolds kept the
generators' double quotes; it now runs the project's own `biome check --write`
and says so if that fails.
