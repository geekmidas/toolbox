---
'@geekmidas/edge': patch
'@geekmidas/cli': patch
---

A wildcard site's certificate through GoDaddy: the shared Traefik edge answers
Let's Encrypt's DNS challenge through whichever provider holds the stage's
domain, Route 53 or GoDaddy

- **`ACME_DNS_CHALLENGES`** (`@geekmidas/edge/proxy/traefik`) maps each DNS
  provider gkm knows to Traefik's (lego's) name for it and the stage secrets it
  reads. The edge's static configuration has one DNS-challenge resolver per
  entry, each with its own ACME store, so stages on different providers share
  one server; the stack's wildcard router names its own provider's
  (`acmeDnsResolver`). Another provider is one entry.
- **GoDaddy**: `dns: { 'example.com': { provider: 'godaddy' } }` with
  `proxy: 'traefik'` now gets a `*.<domain>` certificate from the
  `letsencrypt-dns-godaddy` resolver instead of stopping at
  `WildcardSiteCertificateMissing`. The edge reads the stage's
  `GODADDY_API_KEY` and `GODADDY_API_SECRET` (a GoDaddy API key and secret —
  not `GODADDY_API_TOKEN`): the deploy writes each into its own `0600` file in
  the edge's container before the stack's routes ask for the certificate, and
  the edge's environment names only the files (`GODADDY_API_KEY_FILE`, …). A
  rotated value is rewritten and the edge restarted. Neither is handed to an
  app (`isStackKey`). A stage without them is refused before anything starts,
  with `AcmeDnsSecretsMissing`, naming the `gkm secrets:set` lines.
- **Route 53 is unchanged**: its resolver keeps its name (`letsencrypt-dns`)
  and its store (`/acme/acme-dns.json`), its routers render as before, and its
  key is still issued through IAM. The edge's static configuration gains the
  GoDaddy resolver, so the edge is recreated once on the first deploy after
  upgrading.
- The apex and every named host keep their HTTP-challenge certificates, on
  either provider: a wildcard covers one label, never the domain itself.
