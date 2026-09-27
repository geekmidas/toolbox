---
'@geekmidas/cli': patch
---

`gkm deploy:github --stage <stage> --profile <aws-profile>`: GitHub Actions deploys a stage without AWS keys

Run once per stage, with the profile for that stage's account. It creates
GitHub's OIDC provider in the account if missing, and a role
`<project>-github-<stage>` that only the repository's `<stage>` environment can
assume (`AdministratorAccess` unless `--policy-arn`), then creates that GitHub
environment with `AWS_ROLE_ARN` and `GKM_SECRETS_KEY`. The profile is resolved
on its own — SSO included — and never replaced by `AWS_*` in the environment.
`--dry-run` prints the plan.

Stage and init failures are named errors now (`InvalidStages`,
`UndeclaredStage`, `UnknownDeployTarget`, `NotAnAwsRegion`, `NoStageToTest`,
`SsoSessionExpired`), not bare `Error`s.
