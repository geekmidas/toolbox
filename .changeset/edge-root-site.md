---
'@geekmidas/cli': patch
---

The root site answers on the project's bare host locally, as it does deployed

A deploy points the base domain at one site — the only one, else the one named
`web`, else the one declaring `root: true` — but the local edge put every site
on a subdomain, so `web` was `https://web.shop.localhost` in dev and the bare
domain in production. Both now use one rule (`rootSite`), and locally the root
site is `https://shop.localhost`; every other app stays a subdomain of it. A
stage other than the local one keeps a label (`test.shop.localhost`), because
one edge serves every stage.
