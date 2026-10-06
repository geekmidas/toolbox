---
'@geekmidas/cli': patch
---

Dokploy requests time out instead of hanging

A Dokploy server that accepted the connection and never answered held
`gkm deploy` until the CI runner's own limit. Each `DokployApi` request now
has a deadline — `timeoutMs`, 30 seconds by default — and rejects with
`DokployRequestTimedOut`, which is not retried, since the request may have
arrived. A `signal` option aborts every request and any retry still waiting,
rejecting with the caller's own reason.
