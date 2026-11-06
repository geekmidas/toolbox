---
'@geekmidas/cli': patch
---

A compose stage's OpenObserve keeps its root login when the domain changes

OpenObserve creates its root user only on its first start, in its data
volume. The stack computed the login as `admin@<domain>` on every deploy, so
after a domain change the recreated container's health check, and every app's
OTLP header, signed in as a user that didn't exist, and got 401s.

The login is now stored once. The first deploy after this release writes
`ZO_ROOT_USER_EMAIL` into the stage's secrets, beside `ZO_ROOT_USER_PASSWORD`.
Its value is `admin@<the domain the stage has now>`, the user its OpenObserve
already holds. Every later deploy reads it back and never derives it again,
so OpenObserve, its health check, the OTLP headers and the printed login
share one value. The deploy prints the login without masking it. A deployed
stage with neither a stored login nor a way to store one fails with
`LogsLoginMissing`.

If a stage's domain changed before you upgrade, set the login its volume
holds: `gkm secrets:set ZO_ROOT_USER_EMAIL admin@<old domain> --stage <stage>`.
Until a stage has been deployed once with this release,
`gkm exec --stage <stage>` asks for that deploy, as it does for any key the
deploy has not stored yet.
