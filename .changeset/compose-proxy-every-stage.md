---
'@geekmidas/cli': minor
---

:warning: **Behaviour change:** `deploy.compose.proxy: 'traefik'` applies to every stage, the local one included (#520)

The string form used to cover the deployed stages only, so the local stage
quietly stayed on its own Caddy. Getting Traefik locally meant writing every
stage out in the per-stage map. Now `proxy: 'traefik'` (or `'caddy'`) is
every stage's: `gkm compose --stage <local stage>` starts the shared
`gkm-edge` on this machine and registers the local stack with it, as a
deployed stage's deploy does on its server. The first run moves the stack's
own Caddy off 80 and 443. `gkm dev` is not affected.

The per-stage map is unchanged. It sets each stage it names, and a stage it
leaves out is on Caddy. To keep Caddy locally:
`proxy: { development: 'caddy', staging: 'traefik', production: 'traefik' }`.
No `proxy` at all is still Caddy on every stage. See the upgrading guide,
"After 10.0.0-alpha.183: `proxy: 'traefik'` includes the local stage".
