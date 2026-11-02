---
'@geekmidas/audit': patch
'@geekmidas/cli': patch
'@geekmidas/constructs': patch
'@geekmidas/events': minor
'@geekmidas/telescope': patch
'@geekmidas/testkit': patch
---

Optional peers are imported only by the entry that needs them, and alpha ranges no longer resolve to the stray `10.0.0` (#371)

- **The alpha line stays on the alpha line.** `@geekmidas/*@10.0.0`, published by mistake from the v9 branch, outranks every `10.0.0-alpha.N`, so `~10.0.0-alpha.N` and `^10.0.0-alpha.N` resolved to it, deprecated or not. A prerelease now names its `@geekmidas` siblings as `>=10.0.0-alpha.N <10.0.0` in the published manifest, `gkm init` writes the same range, and `gkm upgrade` moves a project's `~`/`^` alpha ranges to it.
- **A release can't leave the wrong branch.** The publish step refuses a version that is not a prerelease while the packages are in prerelease mode, and a version outside the major a `vN` branch is named for.
- **`@geekmidas/constructs`**: `./aws`, `./crons`, `./endpoints`, `./subscribers`, `./worker`, `./websocket-api`, `./database/kysely`, `./cache`, `./email` and `./testing` no longer import `@geekmidas/audit`, `@geekmidas/db`, `@geekmidas/cache`, `@geekmidas/emailkit`, `@geekmidas/storage`, `hono`, `ws`, `ioredis`, `better-auth` or the AWS SNS/SQS SDKs when they load. Each is loaded when the construct that uses it runs, and a missing one throws `OptionalPeerMissing` naming the package to install. SNS push subscribers verify messages through `@geekmidas/events/sns/message`, which needs no AWS SDK.
- **`@geekmidas/events`**: new `./sns/message` entry, receiving what SNS pushes to an HTTP endpoint (verify, confirm, `toSnsEvent`) without the AWS SDK. `./sns` still exports all of it.
- **`@geekmidas/audit`**: `./memory` no longer needs `@geekmidas/cache`.
- **`@geekmidas/telescope`**: `./hono` and `./server/hono` flush telemetry only when OpenTelemetry is installed.
- **`@geekmidas/testkit`**: `./mailbox` loads `@geekmidas/emailkit` only when it reads mail, and throws `MailboxNeedsEmailkit` without it.
- Each package README lists which entries need which optional peers.
