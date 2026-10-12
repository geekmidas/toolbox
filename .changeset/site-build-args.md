---
'@geekmidas/cli': patch
'@geekmidas/manifest': minor
---

A site's image build gets its own URL and its public stage secrets

`gkm compose --build` used to pass a site only its dependencies' URLs under the
public prefix. A site that read its own URL at build time (`metadataBase` in
Next.js, read while `next build` prerenders) failed in the image build with
`Environment variable "WEB_URL": expected string, received undefined`, even though
`gkm exec -- next build` worked locally. A site with no dependencies got nothing at
all. A public value kept as a stage secret was never passed either, so the deployed
bundle silently went without it.

A site's build now gets, as build arguments its Dockerfile declares:

- its edges' public values, and its own address as `NEXT_PUBLIC_BASE_URL` /
  `VITE_BASE_URL`. The name is the same in every site, whatever the construct is
  called, so the code that reads it can be shared. `publicEnvFor` adds it, so
  `gkm dev` and `gkm exec` get it too;
- its own address under its own name (`WEB_URL`), for server code that runs at
  build time;
- every stage secret that carries the site's public prefix
  (`NEXT_PUBLIC_APP_STORE_URL` for a Next.js site). A secret without the prefix
  never reaches it.

A derived address wins over a stage secret of the same name. To give a site
another address, set its plain `WEB_URL`, which both names then carry. Better still,
change `domains` in `gkm.config.ts`.
