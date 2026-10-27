---
'@geekmidas/cli': patch
'@geekmidas/constructs': patch
'@geekmidas/testkit': patch
---

A site on every subdomain in `gkm dev` and `gkm test`: `*.<project>.localhost`

- The dev edge refuses every protected label (each app's own, and the
  workspace's `protectedSubdomains`) before the wildcard site sees it, and
  asks the site's `hosts` endpoint about every other host. A slug that is not
  a tenant gets that endpoint's own answer, as it will deployed.
- `gkm dev` prints the wildcard site's address with a tenant to open:
  `https://*.shop.localhost:8443 -> http://localhost:3001 (open a tenant: https://acme.shop.localhost:8443)`.
- `browser.on('acme')` in a feature test is the same browser on a tenant's
  host. It keeps the same cookies, address and clients, and sends that host as
  `Origin`, so a test signs in once and acts as two tenants. A testkit
  `Browser` takes the wildcard address as `site`.
