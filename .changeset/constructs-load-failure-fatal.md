---
'@geekmidas/cli': minor
---

:warning: **Behaviour change:** a construct that cannot be loaded fails every command but `gkm dev` with its real error

`gkm build`, `gkm compose`, `gkm exec`, `gkm deploy` and every other command
that reads the workspace used to warn "Could not read constructs, so apps come
from config alone" and carry on. A v10 config declares no apps, so the command
then failed as something else — `gkm build` in a Docker image whose construct
imported a module the image did not carry reported `NotInAnApp`. They now fail
with the error itself (`Cannot find module …`, or the construct's own, such as
`SiteHostsEndpointMissing`).

`gkm dev` still starts from config alone with the warning, so a half-written
declaration does not keep the dev server down. `loadWorkspaceConfig`,
`loadAppConfig` and `loadWorkspaceAppInfo` take `tolerateConstructErrors:
true` for that.
