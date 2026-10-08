---
'@geekmidas/cli': minor
---

`gkm deploy:github` trusts the OIDC subject GitHub actually sends. It reads the repository's subject settings (`gh api repos/<repo>/actions/oidc/customization/sub`) and builds the role's trust from them: the default `repo:<owner>/<name>:environment:<stage>`, the immutable `repo:<owner>@<ownerId>/<name>@<repoId>:environment:<stage>`, or a custom template made of claims known before the run. A template that includes a run-dependent claim (`job_workflow_ref`, `ref`, `sha`, …) is refused with `OidcSubjectNotSupported`; unreadable settings fall back to the default with a warning naming the endpoint. Re-running it rewrites an existing role's trust and prints old → new, which repairs a role that failed with "Not authorized to perform sts:AssumeRoleWithWebIdentity". `--dry-run` prints the subject.

A stage that only the `compose` target deploys now gets an inline `gkm-deploy` policy scoped to its own secrets (the SSM parameter or Secrets Manager secret) and, when the deploy state is in AWS, its state, in place of `AdministratorAccess`. SST and other targets keep `AdministratorAccess`, and `--policy-arn` still overrides both. gkm now tags the role with the managed policy it attached (`gkm:policy-arn`), so a re-run detaches only what gkm put there; an older role's `AdministratorAccess` is left attached, with the command to detach it printed.
