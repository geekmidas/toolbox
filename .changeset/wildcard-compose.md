---
'@geekmidas/cli': patch
---

`gkm compose` deploys a site declared `subdomain: '*'`: every one label under
the stage's domain that no other app answers reaches it, on either proxy.

- **Traefik (the shared edge)**: a `HostRegexp` router below every named
  host's, never matching a protected subdomain or the label of a stage whose
  domain sits under this one's. Its `*.<domain>` certificate comes over the
  DNS challenge when Route 53 holds the domain: the deploy creates an IAM user
  for the server whose per-stack policy writes only that stage's
  `_acme-challenge` TXT record, and writes its key into the edge.
- **Caddy (the stack's own)**: one `https://*.<domain>` block after the named
  ones, with a certificate per tenant on demand, asked of the site's `hosts`
  route first.
- **Either**: a wildcard certificate in `deploy.compose.tls` wins over both. A
  stage with no way to certify its tenants is refused with
  `WildcardSiteCertificateMissing`.
- **DNS**: one `*.<domain>` record beside the named ones, read back like
  them. Route 53's escaped `\052` reads back as `*`.

A wildcard site's `hosts` check no longer refuses a surface whose globbed
endpoints discovery has not folded in yet.
