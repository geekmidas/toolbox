---
'@geekmidas/logger': patch
'@geekmidas/telescope': patch
---

Using the logger interface no longer requires pino

`Logger` is a structural interface — six log methods and `child()` — and
`ConsoleLogger` implements it with no pino anywhere. Pino is one
implementation, reached through `@geekmidas/logger/pino`.

The manifest said otherwise. `pino` and `pino-pretty` were peer dependencies
with no `peerDependenciesMeta` block, which makes them **required**, and npm
installs required peers silently. Since `@geekmidas/logger` is a dependency of
`constructs`, `telescope` and `testkit`, every consumer of the interface was
made to install the one implementation they might never use. Installing
`@geekmidas/logger` now pulls in nothing at all; reaching for
`@geekmidas/logger/pino` is what opts into pino.

**`@geekmidas/telescope` required pino it never imported.** Outside JSDoc and
its own tests it imports `pino-abstract-transport` and nothing else, yet
declared `pino@^9.0.0` — which could not be satisfied beside logger's
`~10.0.0`, so a consumer holding both got `ERESOLVE` and no install. The peer
is gone rather than widened: the honest fix for a dependency that was never
used is to stop declaring it. Its tests now run against the same pino 10 that
logger ships against, where all 447 pass.
