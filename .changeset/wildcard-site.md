---
'@geekmidas/manifest': patch
'@geekmidas/constructs': patch
'@geekmidas/cli': patch
'@geekmidas/cloud': patch
'@geekmidas/telescope': patch
---

A site on every subdomain: `subdomain: '*'`, its `hosts` check, protected subdomains

A multi-tenant app can serve each tenant on its own host,
`acme.example.com/orders/42`:

```ts
export const app = new StaticSite('App', {
  path: 'apps/app',
  variant: 'next',
  subdomain: '*',
  hosts: tenantHosts, // GET ?domain=<host>: 200 for a tenant, 404 otherwise
}).dependsOn([api, auth]);
```

- **Named hosts win.** Every other app keeps its own host. A wildcard site
  never holds the base domain, and a second one is refused
  (`SecondWildcardSite`).
- **`hosts`** is required with `subdomain: '*'` and must be a `GET` endpoint
  the project serves (`WildcardSiteNeedsHosts`, `SiteHostsNotGet`,
  `SiteHostsEndpointMissing`).
- **Protected subdomains.** Every app's own label is protected without being
  listed; `protectedSubdomains: ['www', 'mail', …]` in `defineWorkspace` adds
  the rest. Listing an app's own is refused (`ProtectedSubdomainIsAnApp`).
- **The site reads its tenant from the host.** It's handed `APP_DOMAIN` and
  `APP_PROTECTED_SUBDOMAINS`, also inlined for its bundle
  (`NEXT_PUBLIC_APP_DOMAIN`).
- **Origins follow.** A surface the site depends on trusts
  `https://*.<domain>`. The generated CORS, WebSocket upgrades and Telescope's
  trace trust all match one label in place of the `*`; Better Auth already
  did. `trustsOrigin` is exported from `@geekmidas/constructs/endpoints`.
- **Locally** the site answers on `*.<project>.localhost`.
- **Deployed**, `gkm compose` (`WildcardSiteNotDeployable`) and the AWS target
  (`WildcardSiteNotSupported`) refuse a wildcard site by name until they can
  route every subdomain.
