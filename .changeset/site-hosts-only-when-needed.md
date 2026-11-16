---
'@geekmidas/constructs': minor
'@geekmidas/manifest': patch
'@geekmidas/cli': minor
---

:warning: **Breaking:** a wildcard site's `hosts` is optional, named by surface and path, and required only for on-demand certificates

A `StaticSite` with `subdomain: '*'` no longer has to name a `hosts` route.
Tenants are rows in the app's database, which the app looks up on every
request anyway; behind a wildcard certificate (the DNS challenge on the
Traefik edge, the stage's own `deploy.compose.tls`, CloudFront's) nothing has
to ask before a request reaches the site.

```ts
export const app = new StaticSite('App', {
  path: 'apps/app',
  subdomain: '*',
}).dependsOn([api, auth]);
```

`hosts` is required only where the edge gets a certificate per tenant on
demand — the stack's own Caddy without `deploy.compose.tls` — because Caddy
must ask before it issues one, or anyone could make it request certificates
for any label. That rule lives in one place, the compose stack, and its error
(`WildcardSiteCertificateMissing`) says so.

`hosts` names the route by its surface and path, so a constructs file imports
nothing from an app:

```ts
hosts: { surface: api, path: '/tenants/hosts' },
```

gkm checks that the surface serves `GET <path>` wherever it reads the whole
project (`SiteHostsEndpointMissing`). The endpoint value (`hosts: tenantHosts`)
is still accepted, and declares the same thing, but a construct that imports
an app's endpoint cannot load in an image pruned to another app.

- `WildcardSiteNeedsHosts` is removed from `@geekmidas/constructs/site`.
- A wildcard site declares `<ID>_DOMAIN` and `<ID>_PROTECTED_SUBDOMAINS` with
  or without `hosts`, as every target already handed them.
