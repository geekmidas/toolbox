---
'@geekmidas/manifest': minor
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
'@geekmidas/cloud': minor
---

Host aliases and redirects for `RestApi`, `WebSocketApi` and `StaticSite`

A construct can now answer on more than its one label. `aliases: ['rest']`
serves `rest.example.com` exactly as `api.example.com`, and a site's
`redirects: ['www']` sends `www.example.com` to `example.com` with a 301,
path and query kept. Both are labels under the stage's domain, like
`subdomain`, so they follow per-stage domains, the local `*.localhost` names
and the stage suffix (`www-test.shop.localhost`). The primary host stays
canonical: `<ID>_URL`, client base URLs and OpenAPI servers are unchanged.

- `hostLabels(declaration)` in `@geekmidas/manifest` is the one derivation
  of a construct's labels; `InvalidHostLabel`,
  `HostLabelBothAliasAndRedirect` and `WildcardSiteCannotHaveAliases` are
  thrown when the construct is built.
- Aliases and redirects are protected from a wildcard site's tenants, and a
  label two apps answer on fails the workspace load with `HostLabelTaken`.
- `gkm dev` and both `gkm compose` proxies (Caddy and Traefik) serve every
  host from one route: aliases share the route's checks and handlers, and
  each redirect host answers a permanent redirect. The shared edge's claims,
  DNS records and certificates cover every host.
- A site's aliases join the CORS origins and Better Auth `trustedOrigins`
  of every surface it depends on. Its redirects do not.
- On AWS, where only a wildcard site has a custom domain, either field fails
  the deploy with `HostLabelNeedsCustomDomain`.
