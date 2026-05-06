---
"@geekmidas/cli": patch
---

Fix `gkm openapi` failing on workspace builds when an app uses tsconfig path aliases (e.g. `~/*`) defined only in that app's `tsconfig.json`.

Workspace mode now spawns one subprocess per backend app with `cwd` set to the app's directory, giving each generation its own tsx instance whose tsconfig discovery picks up the app's `paths` aliases. Adds a `--app <name>` flag to `gkm openapi` that the workspace flow uses internally to target a single app.
