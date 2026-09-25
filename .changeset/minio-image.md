---
'@geekmidas/cli': patch
---

Projects with storage could not start: the MinIO image needs a login

MinIO put `quay.io/minio/minio` behind authentication, so every compose file
the CLI writes (`gkm init`, `gkm setup`, `gkm docker`, deploy) failed at the
pull with `unauthorized`. The default is now `pgsty/minio`, a community build
of the same server, pinned at `RELEASE.2026-08-04T00-00-00Z`. It keeps the
same entrypoint, `mc` and `curl`, so the healthchecks and bucket bootstrapping
still work. If a project already pins its own MinIO image in config, that pin
wins.
