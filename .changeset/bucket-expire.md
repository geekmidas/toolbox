---
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
'@geekmidas/cli': minor
---

A bucket can expire what is under a prefix

```ts
new ObjectStorage('Private', { expire: { 'quotes/': { days: 30 } } });
```

`ObjectStorage` and the bucket a `FileServer` vends take `expire`: prefix →
`{ days }`. The manifest records it as `ObjectsDeclaration.expire` (prefix →
days). An empty, rooted or globbed prefix fails with `ExpiryPrefixInvalid`,
anything but a positive whole number of days with `ExpiryDaysInvalid`, and
`expire` on a file server fronting a bucket declared elsewhere with
`BucketOptionOnOrigin`.

The `s3` provider merges one rule per prefix (`gkm-expire-…`) into the
bucket's lifecycle on every deploy, keeping every rule it did not write and
removing its own when no longer declared. `gkm dev`, `gkm test` and
`gkm compose` write the same rules into their MinIO. A CI deploy role now
needs `s3:GetLifecycleConfiguration` and `s3:PutLifecycleConfiguration` on
the stage's buckets; `gkm deploy:github` includes them.
