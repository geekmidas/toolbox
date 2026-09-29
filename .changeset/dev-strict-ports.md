---
'@geekmidas/cli': patch
---

`gkm dev` keeps every app on its provisioned port, on its HTTPS address

- An app in a workspace no longer drifts to the next free port when its own
  is taken. Every other app's URL, CORS origins and cookie domain name that
  port, and the next free one was usually another app's — two backends ended
  up fighting over the web app's. It now fails with `DevPortInUse`, naming
  what holds the port.
- `gkm dev` at a workspace root checks every app's port before starting
  anything, and fails with `WorkspacePortsInUse` listing each one held.
- A dev server exits when the `gkm dev` that started it is gone, even when
  that process was killed outright. Before, the server kept its port and the
  next run found it taken.
- The addresses reconcile resolves — each app behind the edge on its own HTTPS
  host — are no longer overwritten by `http://localhost:<port>` dependency
  URLs. Those now only fill in what reconcile did not resolve. A frontend was
  calling the API on a host its CORS origins did not list.
