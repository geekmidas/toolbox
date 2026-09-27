---
'@geekmidas/cli': patch
---

`gkm init` ships GitHub Actions: CI, a release drafter, and a deploy workflow

Every scaffold gets `.github/workflows/ci.yml` (pull requests: install, build,
lint, typecheck, `test:once` with `GKM_AUTO_SETUP=1`) and a release drafter
that labels pull requests from their titles. With a deploy target it also gets
`deploy.yml`: a push to main deploys the stages that are not protected, and
publishing the drafted release deploys the protected ones. It reads `stages`
from `gkm.config.ts` when it runs rather than naming any, deploys each stage in
the GitHub environment of the same name — `GKM_SECRETS_KEY`, plus
`AWS_ROLE_ARN` (OIDC) for SST or `DOKPLOY_API_TOKEN` / `DOKPLOY_ENDPOINT` for
Dokploy — and follows the project's package manager.
