---
'@geekmidas/cli': patch
---

Pin the local AWS emulator to floci 2.1.0

The compose file `gkm dev` and `gkm test` generate ran `floci/floci:latest`. floci 2.2.0 (published under `latest` on 2026-10-06) answers a KMS decrypt under the wrong encryption context with `UnknownError` instead of `InvalidCiphertextException`, so a project's KMS behaviour locally changed under it. It is pinned to 2.1.0, as MinIO already is.
