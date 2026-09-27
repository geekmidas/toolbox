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
