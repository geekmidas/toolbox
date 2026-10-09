---
'@geekmidas/cli': patch
---

Named errors print without a stack, and missing AWS credentials are named in every command

An error gkm raises on purpose now extends `GkmError`, and every command prints it as `Name: message` (and what caused it, by message), without a stack trace, and exits 1. Any other error keeps its stack, and `--debug` or `GKM_DEBUG=1` shows the stack of both.

The SSM and Secrets Manager stores raise `StageSecretsUnreadable` themselves, on a read or a write, when there are no AWS credentials or AWS refuses them as expired. Every command that touches a deployed stage's secrets (`secrets:add`, `secrets:set`, `secrets:show`, `secrets:unset`, `secrets:migrate`, `setup`, `deploy`, `compose`) says so by name instead of printing the SDK's `CredentialsProviderError`. With a profile, the message says `aws sso login --profile <profile>`. The class lives in `secrets/awsStore.ts` and is still exported from `setup`.
