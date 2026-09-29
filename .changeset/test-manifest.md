---
'@geekmidas/cli': minor
'@geekmidas/constructs': minor
'@geekmidas/client': patch
---

`gkm test` writes a test manifest, and the feature-test kit is built from it

`gkm test` already discovered an app's constructs and resolved its test stage —
then threw both away and left a test to declare them again, environment keys
included. It now writes `.gkm/test/` into each app:

- `manifest.json` — every construct and endpoint's source (file and export) and
  the test stage's environment, keyed as the constructs derive their keys;
- `clients/<surface>.ts` — each surface's typed client, from the generator
  `gkm build` uses;
- `index.ts` — a `Browser` with a typed client per surface and a better-auth
  client per auth server (server plugins paired with their client plugins), the
  drivers the server entry registers, and the configured `it`, with `db` typed
  by the schema of the database the endpoints name.

An app maps `"#test": "./.gkm/test/index.ts"`, and a test is `import { it }
from '#test'` — no construct, environment key or client written by hand.

`featureTest` reads the manifest (`GKM_TEST_MANIFEST`), imports the app's own
construct and endpoint instances from their sources, serves each auth server's
whole origin, and gains `published(topic | queue)` and `subscriber(s)` /
`queue(q)` — handlers run on their own with the test's services and
transactions. Its `modules`/`env` options are gone. `BetterAuth.pluginIds()`
reports the plugins a server runs.

The generated `createApi` for a surface with authorizers accepts a `fetch`, and
`createAuthAwareFetcher`'s type now includes the method calls it already had.

kitchen-sink's suite runs on this, in CI, through `gkm test`: it had run
nothing since its tests moved (a stale `include`), and its constructs glob
missed its endpoints and queues.
