---
'@geekmidas/cli': patch
---

A surface gets the identity of each client that calls it

`MobileApp('App').dependsOn([api])` gave the app `API_URL`, but gave the API
nothing of the app except its scheme inside `API_TRUSTED_ORIGINS`. An API
that redirected an OAuth callback back into the app with
`get('APP_SCHEME')` failed at startup on a deployed stage.

An edge from a client to a `RestApi` or `WebSocketApi` now also hands the
surface the client's own key: `<ID>_SCHEME` from a mobile app and `<ID>_URL`
from a site (`APP_SCHEME`, `WEB_URL`). Each key is named by the caller's id,
so two apps calling one API arrive as `APP_SCHEME` and `ADMIN_APP_SCHEME`.
`gkm dev`, `gkm exec`, `gkm compose` and `gkm docker` all hand out the same
keys, from one rule. The new guide page "Edges and Environment" lists what
each edge hands each side.
