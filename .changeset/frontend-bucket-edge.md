---
'@geekmidas/manifest': patch
'@geekmidas/constructs': patch
'@geekmidas/cli': patch
---

**Security:** a site's or mobile app's plain edge to an `ObjectStorage` no longer hands it the bucket's credentials. `.server` is how it asks for them.

| Caller | `.dependsOn([documents])` | `.dependsOn([documents.server])` |
|---|---|---|
| an API, a worker, any server process | the bucket's connection and the AWS key pair (unchanged) | n/a: the plain edge is already the full one |
| a `StaticSite` or `MobileApp` | `DOCUMENTS_SIGNED_ORIGIN` only, inlined as `<PREFIX>DOCUMENTS_SIGNED_ORIGIN` and in `GKM_IMAGE_ORIGINS`. No connection, no credentials | the connection and the AWS key pair for the server half, plus the signed origin |

- **A site that only shows presigned links holds nothing that writes.** Before, the server half of a site with a plain edge to a bucket held `<T>_CONNECTION_STRING`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_REGION`, on every command (`gkm dev`, `test`, `exec`, compose). Now it holds the signed origin alone, and its `documents` client's methods throw `ObjectStorageReadOnly`, which names `.server`.
- **`ObjectStorage.server`** is a `Declarable`, the same shape as `FileServer.server`, so only a frontend can depend on it. A frontend's edge to a construct's server half is recorded as `server: true` on the manifest's `Dependency`, and `reachesServerHalf()` in `@geekmidas/manifest` is the one rule every command derives a process's keys by.
- **Upgrading:** a site whose server half uploads, presigns or reads through a plain edge to a bucket moves to `.dependsOn([documents.server])`. A backend's edges do not change.
