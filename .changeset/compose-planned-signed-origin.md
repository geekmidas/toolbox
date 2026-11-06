---
'@geekmidas/cli': patch
---

Compose builds a site, or a mobile app's EAS values, for a stage that has never been deployed:

- On a stage whose buckets are on the `s3` provider, a bucket with no stored connection yet has its `<ID>_SIGNED_ORIGIN` derived from config: the name its first deploy gives it (`<scope>-<stage>-<id>`) in the region the provider creates it in (`deploy.objects.<stage>.region`, the secrets store's, then `AWS_REGION`), as `https://<bucket>.s3.<region>.amazonaws.com`. Before, the build refused with `SiteBuildValueUnresolved` until that deploy had run, and a protected stage, built on every push to the default branch ahead of the release that first deploys it, could never be built: so it was never deployed.
- Once the deploy has stored the connection, the origin is derived from it as before, so a bucket that took a suffixed name because another account holds the good one is addressed by its real name from the next build on.
- Nothing is derived against an S3 emulator (`AWS_ENDPOINT_URL`) or with no region to name: the build still refuses there, as it does on the bucket's own endpoint, where only the deploy knows the address.
- `s3Region` moves to the s3 provider's config module, so the stack names a bucket's region without loading the AWS SDK.
