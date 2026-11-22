---
'@geekmidas/edge': minor
'@geekmidas/cli': minor
---

:sparkles: `deploy.cdn`: Cloudflare in front of a compose stage's sites

```ts
dns: { 'example.com': { provider: 'cloudflare' } },
deploy: { cdn: { prod: { provider: 'cloudflare' } } },
```

Every host a site answers on is written proxied through Cloudflare: its own
host, its aliases, its redirects, and a wildcard site's `*.<domain>`. Every
other host stays a plain record to the server. On a Cloudflare domain, gkm now
sets the proxy flag on every record it writes, and a record whose value is
right but whose proxy isn't is updated. Proxied hosts are confirmed by
reading them back from Cloudflare, never by a public lookup.

The server keeps a real certificate for each site host. The shared Traefik
edge gets it over the DNS challenge through Cloudflare, since a proxied host
doesn't reliably pass the HTTP challenge on. That takes `CF_DNS_API_TOKEN`
in the stage's secrets, written into the edge only. A stage with its own
certificate (`deploy.compose.tls`) needs neither.

Cloudflare is also a DNS-challenge provider for a wildcard site's
certificate, and an `EdgeRoute` can ask for its certificate over the DNS
challenge (`dnsCertificate`).

Named errors: `CdnConfigInvalid`, `CdnNeedsDomain`, `CdnNeedsCloudflareDns`,
and `CdnCertificateUnavailable` (Caddy without a stage certificate).
