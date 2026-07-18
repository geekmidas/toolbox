---
'@geekmidas/cloud': minor
---

feat(cloud): add the `Storage` construct

`Storage` is a linkable `sst.aws.Bucket` (`ResourceType.Bucket`). Link it to a
`Function`/`Api`/`Cron` and the runtime resolves a `<NAME>_NAME` environment
variable holding the bucket's name — exactly what `@geekmidas/storage`'s
`AmazonStorageClient.create({ bucket })` consumes. `StorageProps` extends
`sst.aws.BucketArgs`, so native options pass through.
