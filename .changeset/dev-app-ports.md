---
'@geekmidas/cli': minor
---

:sparkles: `gkm dev` moves an app off a port another project holds, and refuses only when the holder is the same app

An app's port was fixed (3000, 3001, …) and `gkm dev` refused to start if anything held one — so two projects that both default to 3000 could not run at once. Now the holder is asked who it is: every process gkm starts is tagged with `GKM_DEV_APP=<workspace>#<app>`, inherited by whatever binds the port, and read back from the holder (`lsof`, then `ps eww` / `/proc/<pid>/environ`).

- **Held by this same app** — left by a previous `gkm dev` — it still refuses, naming the pid (`WorkspacePortsInUse`), since moving would start a second copy.
- **Held by anything else** — untagged, another workspace's, or unreadable — the app moves to the next free port past its siblings', says so, and keeps it in `.gkm/app-ports.json`. The edge routes, every address an app or a phone is handed, and the ready lines follow it.

`gkm exec` applies the same rule but never refuses, since the command may bind nothing. Deploys never read the file.
