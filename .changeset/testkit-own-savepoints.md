---
'@geekmidas/testkit': patch
'@geekmidas/cli': patch
---

:bug: A test's own savepoints survive the per-statement savepoint, and a dry run with no AWS credentials says what it needs

- **Savepoints a test or the code opens are left alone.** Since the bound test connection began wrapping each statement in `SAVEPOINT test_statement … RELEASE`, a test's own `savepoint refused` was wrapped too. The `RELEASE` that followed destroyed it, so a later `rollback to savepoint refused` failed with `savepoint "refused" does not exist`. `SAVEPOINT x`, `RELEASE [SAVEPOINT] x` and `ROLLBACK [WORK|TRANSACTION] TO [SAVEPOINT] x` now pass straight through, with quoted names matched as Postgres matches them. While one is open, statements run unwrapped, as they do inside a `begin`. A deliberate `select 1 / 0` therefore aborts the transaction until the test rolls back to its savepoint. The open names are tracked per connection the way Postgres tracks them: `RELEASE x` ends x and everything opened after it, and `ROLLBACK TO x` keeps x open. With none open, a failing statement still fails alone.
- **`gkm setup --stage <deployed> --dry-run` with no AWS credentials** now fails with `StageSecretsUnreadable` before any provider runs. Previously it failed with the SDK's bare `CredentialsProviderError`. The message says where the stage's secrets are kept (SSM Parameter Store or Secrets Manager) and how to name the account's profile (`--profile <profile>` or `AWS_PROFILE=<profile>`). It also explains that a dry run still reads the secrets, because its plan needs the stage's server (`GKM_SERVER_IPV4`). Every other failure from the store passes through unchanged.
