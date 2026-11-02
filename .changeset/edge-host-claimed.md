---
'@geekmidas/cli': patch
---

Two stacks on one shared Traefik edge can no longer route the same host

Every stack with `proxy: 'traefik'` registers its routes with the server's
shared edge as `dynamic/<project>.yml`. Only hosts within one stack were
checked, so two workspaces (or two stages of one) that both routed
`shop.example.com` both deployed, and which stack the edge sent the host to
was arbitrary.

Each stack's file now opens with the hosts it routes, as a
`# gkm-claims:` comment Traefik ignores. Before a deploy changes anything —
after the server answers, before DNS, secrets, images or containers — it reads
every other project's file on the edge through Docker and stops with
`EdgeHostClaimed`, naming the host and the project that routes it, when one
of its hosts is taken. A wildcard site claims every one label under its domain
but the ones it leaves out. A redeploy of the same project replaces its own
file, `gkm compose --down` frees a stack's hosts, and the check runs again as
the routes are written, with nothing written when it refuses. Files written
by an earlier gkm are read from their routers' rules.
