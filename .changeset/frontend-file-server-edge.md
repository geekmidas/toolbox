---
'@geekmidas/manifest': patch
'@geekmidas/constructs': patch
'@geekmidas/cloud': patch
'@geekmidas/cli': patch
---

A site's or mobile app's plain edge to a file server now gives it the public address only, and `.server` is how it asks for the bucket.

| Caller | `.dependsOn([assets])` | `.dependsOn([assets.server])` |
|---|---|---|
| an API, a worker, any server process | the bucket's connection, the AWS key pair, the file server's `ASSETS_URL` (unchanged) | n/a: use the plain edge |
| a `StaticSite` or `MobileApp` | `ASSETS_URL` only, inlined into the bundle as `<PREFIX>ASSETS_URL`. No bucket, no credentials | the bucket and its credentials for the server half too, plus `ASSETS_URL` |

- **The bundle gets the file server's address.** Before, the site's Dockerfile and compose build args had no file-server key, so a `next.config` reading it got `undefined`. Now they do on either edge, and the bucket's own connection is never inlined.
- **A site that only shows the objects holds nothing that writes.** On a plain edge, a frontend's `assets` client serves (`url()`, `openUrl()`, `processedUrl()`). Its bucket methods throw `FileServerReadOnly`, which names `.server`.
- **Upgrading:** `.server` used to point at the file server's surface. A site whose server half uploads or presigns through a plain edge moves to `.dependsOn([assets.server])`.
