---
'@geekmidas/cli': patch
---

`gkm dev` no longer keeps a Caddy that another checkout of the project started. Every checkout (a worktree beside the main one) shares the compose project name, so a worktree's Caddy passed the health check and kept serving that worktree's routes — an app's HTTPS address answered 502 because it forwarded to ports the worktree's apps had. Caddy now counts as up only when it was created from this checkout; otherwise it is recreated with this checkout's routes.
