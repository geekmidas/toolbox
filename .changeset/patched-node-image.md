---
'@geekmidas/cli': patch
---

Generated Dockerfiles default to `node:22.23.4-alpine`, the latest Node 22 security release, instead of the floating `node:22-alpine` tag. A cached or older image can no longer put a build below the patched version, and the Dockerfile shows which version it runs. A configured `docker.baseImage` still wins.
