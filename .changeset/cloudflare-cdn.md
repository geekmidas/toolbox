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

By default the server shows Cloudflare an origin certificate for those
hosts:

- The deploy makes the key locally and has Cloudflare's Origin CA sign a
  request for exactly those hosts, valid 15 years. The token needs SSL and
  Certificates:Edit.
- Both halves are kept in the stage's secrets as `GKM_SERVER_ORIGIN_CERT` and
  `GKM_SERVER_ORIGIN_KEY`, reserved for the server, and reused until the
  hosts change or expiry is near.
- Either proxy serves it for those hosts alone, beside Let's Encrypt for
  every other host. The server holds no Cloudflare token.

`certificate: 'dns'` uses Let's Encrypt over the DNS challenge through
Cloudflare instead, on the shared Traefik edge, with `CF_DNS_API_TOKEN`.
Cloudflare is also a DNS-challenge provider for a wildcard site's
certificate.

In `@geekmidas/edge`, an `EdgeRoute` can carry its own `certificate`, as files
or over the DNS challenge. Traefik serves a route's files from its certificate
store, Caddy from the route's own `tls` line. `CloudflareApi` can create
origin certificates.

Named errors: `CdnConfigInvalid`, `CdnNeedsDomain`, `CdnNeedsCloudflareDns`,
and `CdnCertificateUnavailable` (`certificate: 'dns'` on Caddy).
