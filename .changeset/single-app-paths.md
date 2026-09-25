---
'@geekmidas/cli': patch
---

A single-app scaffold could not resolve its own `~/` imports

The monorepo and fullstack layouts mapped `~/*` to `./src/*`; a single app did
not. Every `~/…` import the templates write — the api's `~/router.ts`, the
worker's `~/constructs/worker.ts` — resolved to nothing, and the project failed
on its first build with `Cannot find package '~'`.

Found by building a scaffolded worker rather than by reading the generator,
which is the only way this kind of thing is found.
