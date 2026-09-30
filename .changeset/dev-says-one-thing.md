---
'@geekmidas/cli': patch
---

`gkm dev` says each thing once, at the address you use

- Each app is listed once: `api  https://api.shop.localhost:28006 -> http://localhost:3000` — the address it is reached at behind the edge, and the local port the edge forwards to. The per-app banner that printed `Local: http://localhost:3000` as if that were the address is one line now: `✓ api ready in 1.0s  https://… -> http://localhost:3000`, followed by the dev tools it actually mounts (none, for an auth server).
- The build dev runs is quiet — its counts, generated files, manifest and OpenAPI output are `gkm build`'s. So are the watcher's globs and file counts, the secrets count (mostly addresses), and the warning that no local-stage secrets exist: reconcile derives them.
- Servers start through the app's own tsx rather than `npx tsx`, which printed the developer's npm config warnings on every start.
- A browser trusts the edge's HTTPS addresses once its authority is in the system store. `gkm dev` now asks once (or says to run `gkm trust`) for any workspace with apps behind the edge, and `gkm setup` does too — it only did for a workspace with a file server. The trust check reads the system store (`--use-system-ca`), so a root `gkm trust` installed no longer reads as untrusted.
