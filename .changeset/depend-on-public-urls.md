---
'@geekmidas/constructs': patch
---

:sparkles: Depend on a site's or an API's public URL

`StaticSite` and `RestApi` now have a `service`: their public `<ID>_URL`, as a
string. A worker's cron or an endpoint that builds links — an email's sign-in
link, a payment callback — declares `.dependsOn([web, api])` and reads
`services.web` / `services.api`, rather than an undeclared `WEB_URL`. The edge
is what puts the key in its process's environment.

An API's session check (`services.auth`) now forwards the request's `Origin`
to the auth server. It reaches the auth server at its public address, through
the edge, so the origin is what lets the auth server continue the API's trace
for a request from a site both trust.
