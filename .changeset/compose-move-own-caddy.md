---
'@geekmidas/cli': patch
---

Switching a deployed stage from `proxy: 'caddy'` to `proxy: 'traefik'` moves
the stack itself. The first deploy after the switch failed with
`ComposeProxyClash` because the stack's own Caddy still held 80 and 443, and it
could only pass once someone had stopped that Caddy on the server. Now the
deploy removes the stack's Caddy container just before it starts the shared
edge, and says the stage's hosts are offline until the edge is up and the stack
is registered. Any other container holding 80 or 443 is still refused, as
before.
