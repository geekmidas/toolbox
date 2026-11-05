---
'@geekmidas/cli': patch
---

Compose site builds take a bucket's signed origin from where the bucket really is:

- On a stage whose buckets are on a provider (`deploy.objects.<stage>: { provider: 's3' }`), `<ID>_SIGNED_ORIGIN` and `GKM_IMAGE_ORIGINS` come from the stored connection string (`https://<bucket>.s3.<region>.amazonaws.com`), no longer from the in-stack MinIO (`http://minio:9000`). `imageRemotePatterns()` now allows the S3 host, so `next/image` stops refusing presigned links. The MinIO derivation applies only to buckets the stack's MinIO serves.
- A site image built for a deployed stage that hasn't resolved where its pages load files from (a file server's URL, or a bucket's connection for its signed origin) fails with `SiteBuildValueUnresolved`, naming the key and saying to deploy the stage first. It no longer ships without its own asset host.
