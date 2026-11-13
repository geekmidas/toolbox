---
'@geekmidas/cli': patch
'@geekmidas/edge': patch
---

:bug: A site's password works behind Caddy: compose no longer eats the `$` in its bcrypt hash (#513)

The Caddyfile, the stage's own certificate and the shared edge's Traefik configuration are handed to their containers inline, as a config's `content` in the compose file. Compose interpolates variables there, and the `$` in them weren't escaped. The `$2a$10$<salt+hash>` that `basic_auth` checks lost the salt's first letters to an unset variable, so Caddy answered `401` to the right password. A salt starting with `{` made the file fail to parse instead.

Every inline config's content is now written with each `$` as `$$`, compose's escape for a literal `$`, where the stack's compose file is rendered and in the edge's. Compose hands the container the file exactly as written. `composeLiteral()` from `@geekmidas/edge` does the escaping.
