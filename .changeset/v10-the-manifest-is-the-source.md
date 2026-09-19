---
'@geekmidas/audit': major
'@geekmidas/auth': major
'@geekmidas/cache': major
'@geekmidas/cli': major
'@geekmidas/client': major
'@geekmidas/cloud': major
'@geekmidas/constructs': major
'@geekmidas/db': major
'@geekmidas/emailkit': major
'@geekmidas/envkit': major
'@geekmidas/errors': major
'@geekmidas/events': major
'@geekmidas/logger': major
'@geekmidas/manifest': major
'@geekmidas/rate-limit': major
'@geekmidas/schema': major
'@geekmidas/services': major
'@geekmidas/storage': major
'@geekmidas/studio': major
'@geekmidas/telescope': major
'@geekmidas/testkit': major
'@geekmidas/ui': major
---

v10: the manifest is the single source of truth

`gkm.config.ts` used to restate what the constructs already declared — the
apps, their paths, their routes, the containers they wanted, the origins they
trusted. Every one of those was a second place to be wrong. In v10 the config
carries a name, where to find the constructs, the services and the deploy
target; everything else is read from the manifest.

**The surface is the factory.** `e` is gone. An endpoint is built from the
surface that will serve it — `api.post('/users').handle(...)` — so the logger,
the env parser and the authorizers come from the `RestApi` rather than being
threaded in per endpoint. `Endpoint` carries the surface it belongs to, and
that is how the build knows which process an endpoint runs in.

**Apps come from the manifest.** `apps` is no longer a config block. A
declaration carries an `AppSpec` (`path`, and a `code` glob when the surface is
built from files), and the CLI derives the workspace from that. A `RestApi`
that declares its own routes — an auth server mounting a wildcard, where no
glob has anything to find — now has its entry generated from the declaration
itself.

**Every surface gets its own deployment.** An api, an auth server and a studio
are three containers, not one with three route prefixes. Sharing is something a
declaration asks for, never a default. Which site holds the base domain is
declared, and a construct is named by the same rule on every provider.

**Derived rather than configured:** CORS origins from the auth construct's
trusted origins, Studio from the declared database, containers from what the
manifest says exists. Telescope's tables moved into a schema and dropped their
prefix.

**Fixed in the same release:** all four auth middlewares found a cookie by
searching the `Cookie` header for `name=`, so `evil_auth_token=…;
auth_token=…` yielded the attacker's value; `@geekmidas/client` and
`@geekmidas/ui` published exports that resolved to nothing; the MinIO image
moved off Docker Hub and an unpinned `latest` took the dev stack with it.

Upgrading is not mechanical. The config shrinks, `e` disappears, and anything
that assumed one container per workspace now gets one per surface.
