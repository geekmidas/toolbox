---
'@geekmidas/cli': patch
'@geekmidas/constructs': minor
---

`gkm dev` runs crons and queue consumers it was silently skipping

- **Crons under `gkm dev` on the SST target.** Server crons are scheduled through pg-boss. A project that deploys to AWS has no pg-boss locally, so `setupCrons` logged one error and scheduled nothing. Under `gkm dev`, which is one process, crons now run in-process on their schedule, in UTC, via the new `scheduleInProcess` in `@geekmidas/constructs/crons`. Outside `gkm dev` it is still an error, because a timer in each deployed replica would fire every job once per replica.
- **Server-target crons never ran their handler.** The generated `run` called `cron.handler()`, which a `Cron` doesn't have, so every firing logged "Cron failed", on pg-boss too. Crons now run through the new `runCron`, with the same steps as the Lambda adaptor: services, the worker's database as `db`, an auditor if declared, parsed output, and published events.
- **The S3 driver for a workspace that installs `@geekmidas/storage` at its root.** The entry registered the S3 driver only when the app's own `package.json` listed storage. In a workspace that lists it once at the root, any service that injected a bucket threw `UnregisteredStorageScheme`. A queue consumer that depended on a bucket logged that once and was never polled, so its messages sat on the queue. The dependency is now found the way Node resolves it: the app's `package.json` or any directory above it.
