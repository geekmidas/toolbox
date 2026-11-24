---
'@geekmidas/cli': minor
---

`gkm deploy:github` sets up Google's keyless sign-in whenever a stage uses Google

- **No flag.** A stage whose deploy works in Google Cloud — `Maps` on `google`, a `MobileApp` on `google-play` — gets Workload Identity Federation in its project: a `github` pool, a provider whose attribute condition admits only this repository, and a `gkm-github-<stage>` service account that exactly the stage environment's OIDC subject may act as. `--project` names the project.
- **Only the roles the providers need.** Each Google provider declares what a deploy from CI needs (`ResourceProvider.ciGrants`); the account gets those and loses any it no longer needs. A role can be held on one service account rather than the project — CI reads the Play publishing account's keys and no other's.
- **The workflow signs in.** `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT` go on the stage's GitHub environment; the stages action's new `google` output lists the stages that use Google, and the generated deploy job runs `google-github-actions/auth` for them.
- A stage that needs nothing of AWS and uses Google is not asked for AWS credentials.
- A deploy from CI never creates a Google Cloud project: one that finds none stops with `GoogleProjectNotCreated`, and a missing CI sign-in names `gkm deploy:github --stage <stage>`.
