---
'@geekmidas/cli': patch
---

Reconcile provisions again when the role DDL changes

Reconcile skips provisioning when its hash matches the last run's and the
containers are healthy. That hash covered the plan, the compose file and the
Caddyfile, but not the Postgres statements provisioning runs. So a toolbox
upgrade that changed only the role DDL looked converged, and an existing local
database never received the change. The last one was the owner's
`CREATE ON DATABASE` grant from the previous release.

The hash now includes those statements, so the first `gkm dev`, `gkm test` or
`gkm migrate` after such an upgrade provisions again. The statements are
idempotent, so this re-run is safe.
