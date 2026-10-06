---
'@geekmidas/cli': patch
'@geekmidas/constructs': patch
---

Production images: an auth server gets a server, a session reaches its endpoint, an HttpError keeps its status, and a site gets its URLs at build time

- `gkm build --production` for a surface that serves itself — a `BetterAuth` server — now writes and bundles a server that listens on `PORT`, answers `/health` and drains on SIGTERM. It wrote only the dev entry, so its image had no bundle to run.
- An endpoint built from a factory's `.session()` with no authorizer was handed `undefined` for its session in a production build, and its session under `gkm dev`. The optimized handlers now read the session whenever one is configured (`Endpoint.hasSession`).
- An `HttpError` thrown by a handler or a session callback answered 500 from a production server; it now answers with its own status, as under `gkm dev`, without the stack.
- `gkm docker`: a site's public URLs (`VITE_*`, `NEXT_PUBLIC_*`) are build args in `docker-compose.constructs.yml` rather than runtime environment, which a built bundle never reads, and its Dockerfile declares an `ARG` for every one its declaration implies. A site gets no server environment and waits on no infrastructure, and the app services address each other on the compose network rather than through the local edge's hostnames.
