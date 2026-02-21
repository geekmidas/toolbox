---
'@geekmidas/cli': minor
'@geekmidas/events': minor
'@geekmidas/testkit': patch
'@geekmidas/constructs': patch
---

Add pg-boss event publisher/subscriber, CLI setup and upgrade commands, and secrets sync via AWS SSM

- **@geekmidas/events**: Add pg-boss backend for event publishing and subscribing with connection string support
- **@geekmidas/cli**: Add `gkm setup` command for dev environment initialization, `gkm upgrade` command with workspace detection, and secrets push/pull via AWS SSM Parameter Store
- **@geekmidas/testkit**: Fix database creation race condition in PostgresMigrator
- **@geekmidas/constructs**: Add integration tests for pg-boss with HonoEndpoint
