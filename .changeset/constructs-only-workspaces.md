---
'@geekmidas/cli': patch
---

Every workspace declares constructs; the hand-written path is gone

A workspace with no `constructs` glob now fails at load with
`WorkspaceDeclaresNoConstructs`. Its apps, containers and every address —
databases, the broker, each app behind the edge on its own HTTPS host — come
from what it declares, and there is no second way to get them.

Removed with it: reading ports out of a hand-written `docker-compose.yml`
(`resolveServicePorts`, `rewriteUrlsWithPorts`, `startWorkspaceServices` and
the rest of that family), the `http://localhost:<port>` dependency URLs built
from an `apps` block (`getDependencyEnvVars`), `gkm exec`'s `resolveDockerPorts`
option, the pg-boss URL built from old `PGBOSS_DB_*` secrets, and `gkm test`'s
`_test` rewrite of `DATABASE_URL` — reconcile's test stage names its own
databases.
