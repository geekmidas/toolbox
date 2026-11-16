# @geekmidas/edge

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
