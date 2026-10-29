---
'@geekmidas/cloud': patch
'@geekmidas/cli': patch
---

A site on every subdomain deploys to AWS

A site declared `subdomain: '*'` is now one CloudFront distribution under
`*.<domain>`. It gets a wildcard certificate in `us-east-1`, validated
through the stack's Route 53 zone at deploy time, and one `*.<domain>` alias
record. Nothing is created per tenant, and the site's `hosts` route answers an
unknown tenant. Named hosts keep their own records, which Route 53 prefers over
the wildcard.

The stack needs the stage's domain (`new App({ domain, hostedZoneId })`). A
wildcard site on a stack without a domain is refused as
`WildcardSiteNeedsDomain`, which replaces `WildcardSiteNotSupported`.
`gkm build` writes the protected labels into the manifest's `backends`, and
the site gets them inlined as `<ID>_PROTECTED_SUBDOMAINS`, beside
`<ID>_DOMAIN`.
