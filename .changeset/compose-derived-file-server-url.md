---
'@geekmidas/cli': patch
---

Compose builds a site with its file server's URL on the stage's current domain:

- Behind the CDN the `s3` provider makes (the default for `deploy.objects.<stage>: { provider: 's3' }`), a file server's `<ID>_URL` is derived as `https://<label>.<domain>`, as it already was over the stack's MinIO. It is no longer read from the stored copy, which still holds the previous domain until the deploy that follows the build rewrites it. A site image built right after `domains.<stage>` changes now allows the new domain's asset host in `next/image`, and the stack's backends link to the same host.
- A file server URL set by hand (an `'external'` bucket, or one over the stack's MinIO) is kept, and `gkm compose` warns when it differs from the one the stage's domain gives. A stored copy that differs from the CDN's derived address is reported too.
- The S3 provider's CDN host and the compose edge's file server host now come from one function, `fileServerHost`.
