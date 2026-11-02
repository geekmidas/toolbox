---
'@geekmidas/constructs': patch
'@geekmidas/manifest': patch
'@geekmidas/cli': patch
---

A static site can pre-render against its stage's live APIs

`new StaticSite('Docs', { variant: 'static', prerender: 'stage' })` declares
a site whose build fetches from the APIs it `.dependsOn()` and bakes their
answers into its files (vite-ssg and similar). `gkm compose` builds every
other image first, starts the stack but that site, asks each API it depends
on through the edge, and only then builds the site, against the URLs it
inlines: no `GKM_BUILD_OFFLINE`, no refused hosts, and on the local stage its
hosts point at the edge and the build trusts gkm's local CA (build secret
`gkm_local_ca`). The step that fetches is keyed by a per-run
`GKM_PRERENDER_RUN` build argument, so Docker's cache never ships the last
deploy's data. An API that does not answer fails the deploy with
`SitePrerenderApisDown` before the site is built.

It is opt-in because the image then holds that stage's data. `gkm compose
--build --push` builds such a site against the stage as it is running, and
refuses (`SitePrerenderApisDown`, nothing pushed) when it does not answer.
Only a `static` site takes it: the construct throws
`PrerenderNeedsStaticSite` on `next` or `tanstack`.
