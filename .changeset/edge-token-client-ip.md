---
'@geekmidas/cli': patch
'@geekmidas/constructs': patch
'@geekmidas/manifest': patch
---

:bug: A session check through the edge keeps the client's address

An API calls its auth server at its public address, through the stack's edge,
which removed `x-gkm-client-ip` from every request — so the auth server
rate-limited every session check by the API's address. Each stack now has a
token (`GKM_EDGE_TOKEN`, derived from the stage's seed and handed to every
process), which the session check sends as `x-gkm-edge-token`. Caddy, the
shared Traefik and the `gkm dev` edge keep `x-gkm-client-ip` only on a request
carrying it and strip it from every other; the auth server believes the header
only from an internal caller or a request carrying its own token.
