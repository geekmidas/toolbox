---
'@geekmidas/cli': minor
---

:lock: gkm has its own local certificate authority, and a local compose stack's containers can call the stage's own hosts

**One local CA, gkm's.** gkm now makes a root certificate authority once per machine, in `~/.gkm/ca/` (or `$GKM_HOME/ca/`). Its key never leaves that directory. Every local edge serves a certificate issued from it, the way a deployed stage serves its `deploy.compose.tls` files:

- `gkm dev`'s Caddy serves `.gkm/caddy-sites/<stage>.pem`, issued for `<project>.localhost`, `*.<project>.localhost` and any other host it routes.
- A local `gkm compose` stack's Caddy serves one kept in `.gkm/compose/<stage>/local-edge.pem`.
- A certificate is issued again when it nears its end, when a host is missing from it, or when it was not issued by this root.

Caddy's internal CA is no longer used. `.gkm/caddy-root.crt` and `.gkm/compose/<stage>/caddy-root.crt` are no longer copied out of Caddy, so delete them. `NODE_EXTRA_CA_CERTS`, the verify step and the hint `gkm compose` prints all point at `~/.gkm/ca/root.pem`. `gkm trust` creates the root if it is missing and installs it, so it works in any directory before an edge has ever started. **Run `gkm trust` once:** a browser that trusted Caddy's root does not trust gkm's until you do.

**Containers reach the stage's own hosts (#351).** On the local stage, every app, worker and processor container gets three things: an `extra_hosts` entry `<host>:host-gateway` for each of the stage's public hosts, a read-only mount of gkm's root certificate (the certificate only, never its key), and `NODE_EXTRA_CA_CERTS` pointing at that mount. A site's server-side code calling `https://api.<project>.localhost` now reaches the edge and verifies its certificate, instead of failing with `ECONNREFUSED 127.0.0.1:443`. Deployed stages are unchanged.
