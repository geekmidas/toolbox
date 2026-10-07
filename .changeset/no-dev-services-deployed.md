---
'@geekmidas/cli': minor
---

A deployed stage's mail and object storage are real services; Mailpit and MinIO run there only when asked for

On a server target (`dokploy`, `compose`), a stage that is not the workspace's local stage takes its mail and buckets from its secrets: each `Email`'s `<ID>_URL` and `<ID>_FROM`, each bucket's `<ID>_URL` with one `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` pair, and each file server's `<ID>_URL`. A stage missing any of them fails in `validate`, before anything is built, provisioned, generated or written.

- `--allow-dev-services minio,mailpit` on `gkm deploy` and `gkm compose`, and `allowDevServices: ['minio', 'mailpit']` on `deploy()`, run the dev services instead, for a preview or a demo. The phase context carries it to every target as `ctx.allowDevServices`. Keys the stage set still win over a dev service. Every run that uses one prints a warning saying which runs and that it is not production-grade, and emits a `dev-service.used` event. An unknown value fails with `UnknownDevService`. On an `aws` target the flag fails with `DevServicesNeedServerTarget`.
- `gkm compose` runs MinIO on the local stage, as it runs Mailpit, and creates each bucket and its file servers' open paths before any app starts, so the local stage needs no bucket URL. Each file server over the stack's MinIO answers on a host of its own through the stack's Caddy. With `--allow-dev-services`, a deployed stage gets the same: MinIO's root credential is derived from the stage's seed unless the stage set its own key pair, and Mailpit sends from `noreply@<stage domain>` unless `<ID>_FROM` is set.
- On Dokploy, mail is now provisioned: from the stage's secrets, or as a Mailpit compose service named like every other service with `--allow-dev-services mailpit`. Before this, a declared `Email` was skipped and its keys never reached the app.

:boom: Dokploy no longer provisions MinIO for a bucket on a deployed stage by default. A bucket is the stage's own: set its URL and the S3 key pair in the stage's secrets, or pass `--allow-dev-services minio` to keep the MinIO compose stack it ran before.

:boom: A deployed stage missing a mail or storage key fails with one `ExternalServicesNotConfigured` that lists every missing key across every app, each with its `gkm secrets:set … --stage <stage>` line, and names `--allow-dev-services`. It replaces `gkm compose`'s per-key `BucketNotConfigured`, which is removed, and its `StageSecretMissing` for mail. A third party's credentials are still reported one key at a time, by `StageSecretMissing` and `MissingSuppliedSecret`.

:boom: `gkm compose` requires `--stage`. It no longer defaults to the local stage, so which stage a stack is for, and whether its mail and storage must be external, is always written on the command line. The generated compose file's header names the stage in its commands for every stage.
