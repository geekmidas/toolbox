---
'@geekmidas/cli': minor
'@geekmidas/edge': minor
---

:warning: **Behaviour change:** `gkm dev` follows `deploy.compose.proxy`, so `proxy: 'traefik'` runs it behind Traefik (#522)

`gkm dev`, `gkm test` and `gkm setup` now read the local stage's proxy
through `proxyFor`, the function `gkm compose` uses. With `proxy: 'traefik'`
(or a map naming `traefik` for the local stage) they start no `caddy`
container: they start the shared `gkm-edge` on this machine, on 80 and 443,
where it is not running, and register the stage's routes with it — the same
routers on the same hosts, from the same route plan, as
`gkm compose --stage <local stage>` registers, sent to the apps on the host.
The certificate is still gkm's local CA's. A route that changes while
`gkm dev` runs is picked up by the edge without a restart. The apps' URLs
lose the Caddy port (`https://api.<project>.localhost`).

No `proxy`, `proxy: 'caddy'`, or a map that keeps the local stage on Caddy
behaves exactly as before. To keep Caddy for `gkm dev`:
`proxy: { development: 'caddy', staging: 'traefik', production: 'traefik' }`.
See the upgrading guide, "After 10.0.0-alpha.184: `gkm dev` follows
`deploy.compose.proxy`".

`@geekmidas/edge`: a route's upstream can be a process on the Docker host
(`{ onHost: true, port }`, reached through `host.docker.internal`), a handler
can name the path it is sent under (`under`), and a wildcard route can name
the `hosts` route Caddy asks before serving a label. The shared edge maps
`host.docker.internal` to the host gateway, so an existing edge is recreated
once on its next start.
