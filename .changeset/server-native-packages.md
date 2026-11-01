---
'@geekmidas/cli': patch
---

A server image installs the native packages its bundle imports

`gkm build --production` inlined every package into `server.mjs`, and the image shipped no `node_modules`, so an app using a package with native code — `argon2`, `better-sqlite3` — crashed on boot (`ERR_AMBIGUOUS_MODULE_SYNTAX` from `__dirname` in the bundle, and no binary to load). The build now finds each native package the bundle imports, leaves it out, and records it at the version it resolved in `dist/<bundle>.externals.json`; the server, worker and processor images install exactly those, for Linux, beside the bundle. A processor's `.native([...])` is recorded the same way.
