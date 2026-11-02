---
'@geekmidas/cli': patch
---

:bug: The compose warm-up renders a Next site's ISR pages from the deployed APIs

An offline image build still prerenders each ISR page, empty, and Next counts
that copy as fresh for its whole `revalidate` window, so the warm-up's plain
request was answered from the build's cache and rendered nothing (#365).

- For a `next` site, the warm-up reads `preview.previewModeId` from the
  running image's `.next/prerender-manifest.json` — in its container, through
  the stack's Docker engine — and sends it as `x-prerender-revalidate` with
  every request, so Next renders each page again. `/sitemap.xml` is asked
  first, then the URLs it lists. The id is never logged or written.
- Where the id cannot be read, the deploy warns once ("can't force ISR pages
  to render: …") and warms with plain requests; it never fails the deploy.
- The summary reads `x-nextjs-cache`: a page Next answered from its cache is
  counted and named apart (`warmed 12 page(s), 2 served from the build
  cache: /, /about`).
