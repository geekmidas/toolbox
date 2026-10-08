---
'@geekmidas/cli': minor
---

:sparkles: **Providers: `deploy.objects.<stage>: { provider: 's3' }` creates the stage's buckets.**
`deploy.<kind>.<stage>` says what backs a kind of construct on a deployed
stage, keyed by the manifest kind — `objects` first: `'external'` (the
default, today's behaviour), `{ provider: 's3', region?, versioning? }`, or
`false` (the stage has none; a declared bucket is refused with
`StageProviderDisabled`). Anything else, `'minio'` included, fails to load
with `UnknownStageProvider`. The local stage ignores it.

`gkm setup --stage <deployed stage>` runs each configured provider's
`ensure()` in the stage's account — found by `--profile`, `AWS_PROFILE`,
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or the SDK's default chain — and
starts no container. For each bucket construct the `s3` provider creates
`<namespace>-<project>-<stage>-<id>` (a random suffix on `BucketAlreadyExists`,
reused on `BucketAlreadyOwnedByYou`, the name recorded in the stage's state and
reused forever) with Block Public Access, SSE-S3, a TLS-only policy, optional
versioning and CORS for the stage's sites that call an API using it; an IAM
user `gkm-<project>-<stage>-<id>` under `/gkm/`, tagged, with a policy for that
bucket alone; and a key, written into the stage's secrets as
`<ID>_URL=s3://KEY:SECRET@bucket?region=…`. A `FileServer`'s URL becomes the
bucket's regional endpoint, and its `open` paths are public on exactly those
prefixes. Re-runs fix drift and never delete. `--dry-run` prints the plan and
writes nothing; `--rotate-keys` issues a second key and deletes the old one on
the first run after the next deploy (or now, with `--retire-old-keys`).
Without provisioning credentials the stage stays `external`, and a missing
key's line in `ExternalServicesNotConfigured` and `gkm secrets:add` names the
command that writes it. Every compose and Dokploy deploy runs the provider's
`verify()` — `HeadBucket` with the app's key — and stops with
`ProvisionedBucketUnreachable` when it fails.

:boom: **`--allow-dev-services` no longer takes a list.** It is a switch on
`gkm deploy` and `gkm compose` (`deploy({ allowDevServices: true })`;
`ctx.allowDevServices` is a boolean): every construct a deployed stage does
not account for — no key in its secrets, no provider for its kind — gets its
dev service, MinIO for a bucket and Mailpit for mail. A value
(`--allow-dev-services minio`) fails with `AllowDevServicesTakesNoValue`;
`UnknownDevService` is gone.
