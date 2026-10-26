---
'@geekmidas/cli': patch
---

Projects with storage could not start: the MinIO image is gone from Docker Hub

MinIO removed `minio/minio` from Docker Hub, so every compose file the CLI writes (`gkm init`, `gkm docker`) failed at the pull. The default is now `pgsty/minio`, a community build of the same server, pinned at `RELEASE.2026-08-04T00-00-00Z`. It keeps the same entrypoint, `mc` and `curl`, so the healthchecks and bucket bootstrapping still work. If a project already sets its own MinIO image or version in config, that still wins.
