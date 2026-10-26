---
'@geekmidas/constructs': patch
'@geekmidas/cli': patch
---

Seeds are handed the stage's env

`gkm seed` and `gkm dev --seed` resolved the stage's env and used it only for the owner connection. Seeds got `{ stage }`, and `process.env` was never filled, so a seed building a construct's service had no URLs to give its `EnvironmentParser` and failed with `ASSETS_URL: expected string, received undefined`. `SeedContext` now carries `env`, the stage's resolved environment, so a seed calls `register({ envParser: new EnvironmentParser(env), context })` the way a handler's service is built. `gkm exec -- gkm seed` is no longer needed as a workaround.
