---
'@geekmidas/cli': patch
---

The deploy workflow `gkm init` writes logs in to the registry gkm.config.ts names when it runs

The registry login was written into the workflow from what init was told, so
a bare namespace (`acme`) became `registry: acme` with no credentials, and a
later change to `deploy.registry` never reached the workflow. `gkm stages
--github-output` (and the stages action) now output `registry`, the host to log
in to — `ghcr.io`, another registry's host, or `docker.io` for a Docker Hub
namespace — and both jobs log in to it: GitHub's token on ghcr.io, the stage's
`REGISTRY_USERNAME`/`REGISTRY_PASSWORD` elsewhere.

The workflow also frees the runner's disk before building every image, cancels
a push build a newer push supersedes, fails the build when it kept no digests,
and names a manual run's bad `ref` instead of failing on an empty commit.
