---
'@geekmidas/cli': minor
---

:globe_with_meridians: `gkm compose` can run the local stage behind the shared Traefik edge, and any stage can bring its own certificate

**The local stage behind Traefik (#352).** Name the local stage in the per-stage map, as in `deploy.compose.proxy: { development: 'traefik', production: 'traefik' }`, and `gkm compose --stage development` starts `gkm-edge` on this machine and registers the local stack with it, the way a deployed stage registers on its server. Local runs then go through the same edge, routes and middlewares as staging and production. The plain string form (`proxy: 'traefik'`) still applies to the deployed stages only, so the local stage stays on Caddy in that case. On Traefik, the local stage's certificate is the one gkm's local CA issues, written into the edge's `certs/` volume where a deployed stage's own certificate goes. `gkm trust` is still the one step to trust it. The Mailpit inbox route and the containers' `extra_hosts`/host-gateway entries work as they do on Caddy, and `--down` unregisters the local stack from the edge.

**Certificates don't depend on the proxy.** `deploy.compose.tls.<stage>` is accepted for any stage, the local one included, on either proxy. `ComposeTlsOnLocalStage` is removed. Without a certificate of its own, a deployed stage uses Let's Encrypt and the local stage uses gkm's local CA. A local certificate you supply replaces gkm's.

**`tls.<stage>.caFile`.** This is the root the certificate chains to, for one no public CA issued (an mkcert root, a company CA). The post-start check (🩺) trusts whichever CA issued the stage's certificate: gkm's root for gkm's certificate, the `caFile` for a supplied one, and otherwise Node's default roots plus `NODE_EXTRA_CA_CERTS`. It never assumes gkm's root. On the local stage, the stack's containers are given the `caFile` in place of gkm's root, and the printed hint names it.
