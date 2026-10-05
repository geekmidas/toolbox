---
'@geekmidas/cli': patch
---

`gkm dev` on macOS no longer moves a Next.js app off its port because of its own leftover server

The process that holds a Next.js app's port is `next-server`, which renames itself. On macOS that overwrites what `ps eww` reads, so gkm couldn't see the app tag it inherited, treated the holder as another project's, and moved the app to a new port for good in `.gkm/app-ports.json`. When the holder's own tag can't be read, gkm now uses the tag of its nearest parent (here the `next dev` it started), so a leftover server is refused as running rather than moved around.
