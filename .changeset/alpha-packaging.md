---
'@geekmidas/constructs': patch
'@geekmidas/cli': patch
---

The published package could not be installed

`10.0.0-alpha.1` crashed on `gkm init`. Three packaging faults, each of which
made `@geekmidas/constructs` unloadable for anyone who was not inside this
repository — where pnpm's workspace links hid all of them.

**Statically imported packages were declared optional peers.** `queue/Queue.ts`
imports `Publisher` from `@geekmidas/events` as a value, and `envkit`,
`errors`, `logger`, `manifest`, `schema` and `services` are imported by entries
that always load. All were `peerDependenciesMeta.optional`, so a consumer's
install fetched none of them. Installing the tarball on its own produced a
package where *no entry point loaded at all* — `gkm init` only reached
`@geekmidas/events` because the CLI happened to depend on the rest directly.
They are dependencies now, which is what a static import means.

**`@geekmidas/telescope` was a required peer of a type-only import.**
`rest-api.ts` does `import type { Telescope }`, which has no runtime, yet the
peer was non-optional and exactly pinned — so every install warned it was
missing and pnpm reported `Conflicting peer dependencies` against the CLI's own
range. Marked optional.

**Declaring a cron required AWS Lambda middleware.** `crons/index.ts`
re-exported `AWSScheduledFunction`, so importing the barrel to declare a cron
pulled in `@middy/core`. The adaptor was already exported from
`@geekmidas/constructs/aws`, the entry that admits it needs Lambda; the
redundant re-export is gone and `CronGenerator` emits the `/aws` specifier.

Verified by packing the tarballs, installing them into an empty project the way
a consumer does, and running `gkm init --monorepo` to completion.
