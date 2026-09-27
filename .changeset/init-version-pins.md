---
'@geekmidas/cli': patch
---

`gkm init` takes every third-party version from one place, and a construct edit invalidates cached builds

Scaffold versions were hardcoded across the templates and generators and had
never been reviewed against latest. They now all come from
`init/dependencies.ts`, in three groups: current dependencies (inside every
`@geekmidas` peer range), the build and test toolchain (held at its current
versions until tranche 2, #40, moves it), and the Expo SDK 55 set. A scan test
fails on any version literal outside that file.

Scaffolds get Turbo 2.11. Turbo 2.3 ignored `$TURBO_ROOT$`, so the per-app
`turbo.json` files `gkm build` generated never hashed the root constructs:
editing `constructs/database.ts` replayed a stale cached build. The root
`turbo.json` that `init` writes now declares those inputs once for every
package, and `gkm build` no longer writes `apps/*/turbo.json`.
