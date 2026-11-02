---
'@geekmidas/cli': patch
---

A site's image build fails fast on its APIs, and a deploy warms its pages

A site's image is built without its APIs, and now says so. Every site
Dockerfile sets `GKM_BUILD_OFFLINE=1` in its builder stage (never in the
running container): the signal a site's own code tests to skip build-time
fetches and render data-backed pages on request instead. `gkm compose` also
maps the site's own host and its `.dependsOn()` hosts to `127.0.0.1` in the
build's `/etc/hosts`, so a fetch to an API that is not up yet is refused at
once instead of hanging until Next's 60-second prerender limit. The URLs the
bundle inlines are unchanged.

After a compose deploy is healthy, `verify` warms each `next` and `tanstack`
site: it asks `/`, `/sitemap.xml` and every page the sitemap (or a sitemap
index, one level deep) lists, through the edge as the health check does, four
at a time and at most 500 per site. A page that fails to warm is listed as a
warning and never fails the deploy. A site on every subdomain is skipped.
