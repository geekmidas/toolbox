---
'@geekmidas/cli': minor
---

`gkm compose` runs a workspace's APIs and sites for a stage as one Docker Compose stack behind Caddy

`gkm compose [--stage <stage>] [--tag <tag>] [--build | --pull] [--dry-run] [--down]` writes `.gkm/compose/<stage>/` — a compose file, a Caddyfile and one env file per backend holding only the keys that app reads (mode 0600) — and starts it: Postgres first, then its databases, roles and migrations, then the apps, with one Caddy serving every app on its own host over HTTPS (the stage's domains with Let's Encrypt; `*.localhost` with Caddy's own CA locally). An auth server trusts the internal origin of every service that calls it across the compose network as well as the public ones.

With `--tag`, every app's image is looked up in the registry first and nothing is pulled or started unless all of them exist (`ImageTagNotFound` names each missing one); a site's image is tagged `<tag>-<stage>`, since its public URLs are build args. Without a tag the stack is built from the checkout and tagged with the commit. Each run records the tag and digest per app in the stage's deploy state. Workers and object storage are not run yet; a bucket's URL comes from the stage's secrets.
