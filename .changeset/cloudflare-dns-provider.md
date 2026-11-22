---
'@geekmidas/edge': minor
'@geekmidas/cli': minor
---

:sparkles: Cloudflare is a DNS provider

`dns: { 'example.com': { provider: 'cloudflare' } }` writes a stage's records
through Cloudflare's v4 API. Like GoDaddy, it reads and writes only the A,
AAAA, CNAME and MX records of the names a deploy serves. The token is
`CLOUDFLARE_API_TOKEN` (an API token with `Zone:Read` and `DNS:Edit` on the
zone), or `gkm login --provider cloudflare`, and the generated GitHub workflow
passes it to the deploy step.

A record carries an optional `proxied` flag (`UpsertDnsRecord.proxied`), which
puts Cloudflare's CDN in front of the name. gkm doesn't set it yet. An update
keeps a record's existing proxy setting, and a new record is created
unproxied.

`DnsProviderNotImplemented` is removed: every provider `dns` names is built.
