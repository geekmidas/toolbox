---
'@geekmidas/envkit': minor
---

feat(envkit): add an SST env-var validator to `@geekmidas/envkit/sst`

Adds `EnvValidator`, `resolveEnvKeys`, and `EnvValidationError` alongside
`SstEnvironmentBuilder`, so a deployable unit's required environment variables
can be validated **before** deploy — at `sst.config.ts` synth time.

- `resolveEnvKeys` derives the env-var keys a set of linked resources will
  produce by replaying the **same** `sstResolvers` used at runtime (reduced to
  the resource `type`, so no SST `Output` value is ever read). The infra-time
  validator and the runtime resolution share a single source of truth — they
  cannot drift, and there is no parallel suffix table to maintain.
- `EnvValidationError` is a structured, catchable error carrying `.missing`,
  `.available`, `.suggestions`, and `.context`. Its message names the failing
  unit and gives a nearest-match "did you mean DB_URL?" hint per missing
  variable (edit-distance + token-overlap).
- Platform whitelists are **exported, never assumed** — SST deploys to AWS, GCP,
  and Cloudflare. `AWS_RUNTIME_ENV_VARS`, `GCP_RUNTIME_ENV_VARS`,
  `CLOUDFLARE_RUNTIME_ENV_VARS`, the `PLATFORM_ENV_VARS` registry, and
  `platformEnvVars(platform)` are exported; the caller opts in via
  `new EnvValidator(links, { platform })`. Optional vars are marked with a
  trailing `?`.
- `getProvidersForEnvVars(requested)` returns the link names that provide a
  requested var, for least-privilege linking (attach only the links a unit needs).
