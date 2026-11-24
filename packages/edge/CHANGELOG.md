# @geekmidas/edge

## 10.0.0-alpha.198

### Patch Changes

- Updated dependencies []:
  - @geekmidas/manifest@10.0.0-alpha.198

## 10.0.0-alpha.197

### Patch Changes

- Updated dependencies []:
  - @geekmidas/manifest@10.0.0-alpha.197

## 10.0.0-alpha.196

### Patch Changes

- Updated dependencies [[`dfbdd8d`](https://github.com/geekmidas/toolbox/commit/dfbdd8d844e0bb302ee7a7d5ea5744d7dc057bfb)]:
  - @geekmidas/manifest@10.0.0-alpha.196

## 10.0.0-alpha.195

### Patch Changes

- Updated dependencies [[`46bdbb3`](https://github.com/geekmidas/toolbox/commit/46bdbb36b1f6b7f42a5ac6f65addf7801895e36e)]:
  - @geekmidas/manifest@10.0.0-alpha.195

## 10.0.0-alpha.194

### Patch Changes

- Updated dependencies []:
  - @geekmidas/manifest@10.0.0-alpha.194

## 10.0.0-alpha.193

### Patch Changes

- Updated dependencies []:
  - @geekmidas/manifest@10.0.0-alpha.193

## 10.0.0-alpha.192

### Patch Changes

- Updated dependencies [[`6022ce3`](https://github.com/geekmidas/toolbox/commit/6022ce3c5f6c69c9ef3799344fa43cc71eabd087)]:
  - @geekmidas/manifest@10.0.0-alpha.192

## 10.0.0-alpha.191

### Patch Changes

- Updated dependencies [[`989e54d`](https://github.com/geekmidas/toolbox/commit/989e54d1796a730a215ce4fc3322b087371bcac1)]:
  - @geekmidas/manifest@10.0.0-alpha.191

## 10.0.0-alpha.190

### Minor Changes

- [#547](https://github.com/geekmidas/toolbox/pull/547) [`993493a`](https://github.com/geekmidas/toolbox/commit/993493af380c6549b834a5be759ff2d3e0cbf28c) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `deploy.cdn`: Cloudflare in front of a compose stage's sites

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

### Patch Changes

- Updated dependencies []:
  - @geekmidas/manifest@10.0.0-alpha.190

## 10.0.0-alpha.189

### Minor Changes

- [#546](https://github.com/geekmidas/toolbox/pull/546) [`27a81a2`](https://github.com/geekmidas/toolbox/commit/27a81a2b1d82236a318e514b71a64dcd17cea304) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: Cloudflare is a DNS provider

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

### Patch Changes

- Updated dependencies []:
  - @geekmidas/manifest@10.0.0-alpha.189

## 10.0.0-alpha.188

### Patch Changes

- Updated dependencies [[`076daf0`](https://github.com/geekmidas/toolbox/commit/076daf034063ae04877f5876cd6428238ad5a42d)]:
  - @geekmidas/manifest@10.0.0-alpha.188

## 10.0.0-alpha.187

### Patch Changes

- Updated dependencies [[`243d10a`](https://github.com/geekmidas/toolbox/commit/243d10ad2a5a27ebe70d85c45c9869f3c3342f56)]:
  - @geekmidas/manifest@10.0.0-alpha.187

## 10.0.0-alpha.186

### Patch Changes

- [#527](https://github.com/geekmidas/toolbox/pull/527) [`7d835af`](https://github.com/geekmidas/toolbox/commit/7d835af79a61c86db64ecf209f64290217cf102a) Thanks [@geekmidas](https://github.com/geekmidas)! - A wildcard site's certificate through GoDaddy: the shared Traefik edge answers
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

- Updated dependencies []:
  - @geekmidas/manifest@10.0.0-alpha.186

## 10.0.0-alpha.185

### Minor Changes

- [#524](https://github.com/geekmidas/toolbox/pull/524) [`80349a4`](https://github.com/geekmidas/toolbox/commit/80349a402d8de7430db71bf397b3a4afb6ff724d) Thanks [@geekmidas](https://github.com/geekmidas)! - :warning: **Behaviour change:** `gkm dev` follows `deploy.compose.proxy`, so `proxy: 'traefik'` runs it behind Traefik (#522)

  `gkm dev`, `gkm test` and `gkm setup` now read the local stage's proxy
  through `proxyFor`, the function `gkm compose` uses. With `proxy: 'traefik'`
  (or a map naming `traefik` for the local stage) they start no `caddy`
  container: they start the shared `gkm-edge` on this machine, on 80 and 443,
  where it is not running, and register the stage's routes with it — the same
  routers on the same hosts, from the same route plan, as
  `gkm compose --stage <local stage>` registers, sent to the apps on the host.
  The certificate is still gkm's local CA's. A route that changes while
  `gkm dev` runs is picked up by the edge without a restart. The apps' URLs
  lose the Caddy port (`https://api.<project>.localhost`).

  No `proxy`, `proxy: 'caddy'`, or a map that keeps the local stage on Caddy
  behaves exactly as before. To keep Caddy for `gkm dev`:
  `proxy: { development: 'caddy', staging: 'traefik', production: 'traefik' }`.
  See the upgrading guide, "After 10.0.0-alpha.184: `gkm dev` follows
  `deploy.compose.proxy`".

  `@geekmidas/edge`: a route's upstream can be a process on the Docker host
  (`{ onHost: true, port }`, reached through `host.docker.internal`), a handler
  can name the path it is sent under (`under`), and a wildcard route can name
  the `hosts` route Caddy asks before serving a label. The shared edge maps
  `host.docker.internal` to the host gateway, so an existing edge is recreated
  once on its next start.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/manifest@10.0.0-alpha.185

## 10.0.0-alpha.184

### Patch Changes

- Updated dependencies []:
  - @geekmidas/manifest@10.0.0-alpha.184

## 10.0.0-alpha.183

### Patch Changes

- Updated dependencies []:
  - @geekmidas/manifest@10.0.0-alpha.183

## 10.0.0-alpha.182

### Patch Changes

- 🐛 [#516](https://github.com/geekmidas/toolbox/pull/516) [`818c22f`](https://github.com/geekmidas/toolbox/commit/818c22f6cec9309cb6e6d75637bf9ab088e533d1) Thanks [@geekmidas](https://github.com/geekmidas)! - :bug: A site's password works behind Caddy: compose no longer eats the `# @geekmidas/edge in its bcrypt hash (#513)

  The Caddyfile, the stage's own certificate and the shared edge's Traefik configuration are handed to their containers inline, as a config's `content` in the compose file. Compose interpolates variables there, and the `# @geekmidas/edge in them weren't escaped. The `$2a$10$<salt+hash>`that`basic_auth`checks lost the salt's first letters to an unset variable, so Caddy answered`401`to the right password. A salt starting with`{` made the file fail to parse instead.

  Every inline config's content is now written with each `# @geekmidas/edge as `$`, compose's escape for a literal `# @geekmidas/edge, where the stack's compose file is rendered and in the edge's. Compose hands the container the file exactly as written. `composeLiteral()` from `@geekmidas/edge` does the escaping.

- Updated dependencies []:
  - @geekmidas/manifest@10.0.0-alpha.182

## 10.0.0-alpha.181

### Patch Changes

- Updated dependencies []:
  - @geekmidas/manifest@10.0.0-alpha.181

## 10.0.0-alpha.180

### Patch Changes

- ✨ [#464](https://github.com/geekmidas/toolbox/pull/464) [`82369df`](https://github.com/geekmidas/toolbox/commit/82369df0d0abaf17d8af0f30d85f0f5a1e5faae7) Thanks [@geekmidas](https://github.com/geekmidas)! - New package: `@geekmidas/edge`, the edge in front of a stack

  The route model, both reverse proxies' renderers, gkm's local certificate authority and the DNS providers move out of the CLI into one package. Anything that changes the edge while a stack runs can now use the same code where the CLI isn't installed. Nothing the CLI does changes.

  - Each piece is its own entry point: `/routes`, `/proxy/caddy`, `/proxy/traefik`, `/certificates/local`, `/dns`, `/dns/route53`, `/dns/hostinger`, `/dns/godaddy`. Only `/dns/route53` loads the AWS SDK, which is now an optional peer.
  - The providers take their credentials as given. `HostingerProvider` and `GoDaddyProvider` take a function, called the first time the API is used. Reading `GODADDY_API_TOKEN`, `HOSTINGER_API_TOKEN` or a stored `gkm login`, and saying what to do when there is none, stays in the CLI.
  - `localAuthorityPaths(home)` takes the home it uses; the CLI passes `GKM_HOME` or `~/.gkm`.
  - The edge's own errors extend `EdgeError`, which the CLI prints like its own: name and message, no stack.

  The deployment guide gains "Scope each provider's credentials": what each DNS provider can be limited to, and a Route 53 IAM policy for one zone, the stack's record types and its names.

- Updated dependencies []:
  - @geekmidas/manifest@10.0.0-alpha.180
