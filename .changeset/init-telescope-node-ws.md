---
'@geekmidas/cli': patch
---

`gkm init` installs `@hono/node-ws` in an app with Telescope. The server `gkm dev` generates imports it for Telescope's live feed, and without it every start warned "Cannot find package '@hono/node-ws'".
