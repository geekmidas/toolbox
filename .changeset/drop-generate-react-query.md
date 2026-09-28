---
'@geekmidas/cli': patch
---

`gkm generate:react-query` is removed, and with it the `openapi-typescript` dependency

It read an `openapi.json` and shelled out to `npx openapi-typescript`. Each
surface's typed client is written by `gkm build` (and kept current by
`gkm dev`) to `.gkm/openapi/<surface>.ts`, built from the endpoints
themselves: its `createApi()` returns a typed fetcher with React Query hooks.
Verified against openapi-typescript on kitchen-sink's endpoints, its types
match. Import that file instead. The `@geekmidas/cli/openapi-react-query`
export is gone too.
