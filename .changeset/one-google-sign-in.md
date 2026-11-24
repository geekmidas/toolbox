---
'@geekmidas/cli': minor
---

One Google sign-in for every command, `--project` on `gkm deploy` and `gkm compose`, and Google credentials in CI without gcloud

- **`providers/google`.** The Play setup's Google code is now every Google provider's: the API client, gcloud's sign-in in gkm's own config, and the project, API, service account and key helpers.
- **CI signs in from `GOOGLE_APPLICATION_CREDENTIALS`.** The `external_account` file `google-github-actions/auth` writes is exchanged at STS and, with a service account named, impersonated — plain HTTPS, no gcloud and no Google client library. A service account key and an `authorized_user` file are read too. Without the variable, gkm's own gcloud sign-in is used, as before.
- **Scopes are asked for, not fixed.** A sign-in that lacks a scope a command needs signs in again for every scope so far, so the Play setup and later Google providers share one sign-in.
- **`--project`** on `gkm deploy` and `gkm compose`: the Google Cloud project for the stage's Google providers, else `deploy.<kind>.<stage>.project`, else `<workspace>-<stage>`. The first deploy records it in the stage's state; a later one that resolves another stops with `GoogleProjectChanged`.
- **A provider names its cloud** (`ResourceProvider.cloud`), and `stageClouds(workspace, stage)` says which clouds a stage needs credentials for. `ProviderCredentialsMissing` names the CI sign-in for that cloud.
- :boom: **`gkm deploy:init --project` is `--dokploy-project`**, and `--project-id` is `--dokploy-project-id`, so `--project` means a Google Cloud project everywhere.
