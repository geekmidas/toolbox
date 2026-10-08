---
'@geekmidas/cli': minor
---

`gkm compose` can register a deployed stage with a shared Traefik edge

`gkm compose` can serve a deployed stage through a shared Traefik edge: `deploy.compose.proxy: 'traefik'` (for every deployed stage, or per stage) registers the stack's hosts with one Traefik per server — compose project and network `gkm-edge`, configured through its file provider from `$GKM_HOME/edge`, no Docker socket — which owns 80/443, Let's Encrypt and the redirect to HTTPS, so several stacks can share a server. `'caddy'` stays the default, and the local stage always uses Caddy. Both proxies render one route model. Only a stack's public services join the edge's network, each under a project-prefixed alias. `--down` unregisters a stack and leaves the edge and other stacks running. `deploy.compose.tls.<stage>` gives a stage its own certificate on either proxy. A clash over 80/443 between a stack's own Caddy and the edge is refused with `ComposeProxyClash`.
