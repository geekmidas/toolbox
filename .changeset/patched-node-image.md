---
'@geekmidas/cli': patch
---

Generated Dockerfiles default to `node:22.23.4-alpine`, the latest Node 22 security release, instead of the floating `node:22-alpine` tag. A cached or older image can no longer put a build below the patched version, and the Dockerfile shows which version it runs.

The image is a `NODE_IMAGE` build argument, so you can pick another Node version without regenerating anything: set `build.args.NODE_IMAGE` on the app in your own `docker-compose.yml`, or pass `docker build --build-arg NODE_IMAGE=…`.
