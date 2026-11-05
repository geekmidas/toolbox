---
'@geekmidas/manifest': patch
'@geekmidas/storage': patch
'@geekmidas/cloud': patch
'@geekmidas/cli': patch
---

A Next site can build `images.remotePatterns` from the workspace:

```ts
// apps/web/next.config.ts
import { imageRemotePatterns } from '@geekmidas/cli/next';

export default {
  images: { remotePatterns: [...imageRemotePatterns() /* , third parties */] },
};
```

It returns one pattern for each file server the site has an edge to, and one for the host each bucket it reaches signs its links on. The values are the stage's own, so new stages, renamed file servers and newly created buckets need no edits. Under `gkm dev` the patterns are the local file server host and MinIO's address. Without gkm's env (a plain `next build`) it returns `[]`.

What it reads is not Next-specific:

- **`<ID>_SIGNED_ORIGIN`**: where a bucket's presigned links point (`https://<bucket>.s3.<region>.amazonaws.com`, an S3-compatible endpoint's host, MinIO locally). It is derived from the bucket's connection, carries no credentials, and is inlined into a site or app with an edge to the bucket or to a file server over it. `s3Url.signedOrigin()` in `@geekmidas/storage` computes it.
- **`<PREFIX>GKM_IMAGE_ORIGINS`**: the site's file-server and signed-link origins as one comma-separated list. It is passed by `gkm dev`, compose site builds (an `ARG` in the site's Dockerfile) and the AWS target. A Vite or Expo site can feed it to a CSP.
