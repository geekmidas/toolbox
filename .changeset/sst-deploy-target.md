---
'@geekmidas/cli': minor
---

`gkm deploy` deploys an SST workspace: `sst` is a built-in deploy target

- **`gkm deploy --stage <stage>` on `deploy: { default: 'sst' }`** runs `gkm build --provider aws --stage <stage>` and then `sst deploy --stage <stage>` in the deploy's sandbox, and health-checks each surface URL `run()` returns in `sst.config.ts` (read from `.sst/outputs.json`: an API's `/health`, a site's `/`), emitting `health.checked`. It used to refuse SST with "run `gkm build && sst deploy`". Capabilities: no rollback, migrations by the target, no images.
- **An `aws` credential kind.** `CredentialProvider` answers `{ kind: 'aws', stage }` with a profile or keys (`AwsCredential`). From the environment: `AWS_PROFILE` alone when set, else `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`. Only `sst deploy` is handed them, in its own environment; the build and every other sandboxed step see no `AWS_*`. Missing ones fail validation with `MissingCredential`; a workspace with no `sst.config.ts` fails with `SstConfigNotFound`; a surface that never answers fails verify with `SurfacesUnhealthy`.
- **Scaffolds deploy through `gkm deploy`.** `gkm init --deploy sst` writes `deploy:<stage>` scripts as `gkm deploy --stage <stage>`, and an `sst.config.ts` whose `run()` returns each surface's URL. The scaffolded GitHub deploy workflow runs `gkm deploy --stage "$STAGE"` for every target.
