# Deprecated Deploy APIs

The headless, pluggable deploy (`deploy()`, `DeployTarget`, the `dokploy`,
`compose` and `sst` targets) left a few old entry points in place so that
nothing broke in the alpha that replaced them. They are kept for one more alpha
and then removed.

**Removal target: the alpha after next.** At the time of writing the current
release is `10.0.0-alpha.65`. The next alpha ships the Dokploy engine's move under
`target/dokploy/` with re-exports at the old paths. Everything below is removed in
the alpha after that one (`10.0.0-alpha.67`). Each removal is a breaking change
and gets its own `:boom:` changeset line.

## What is removed

### Flags

| Deprecated | Since | Use instead | Today |
|---|---|---|---|
| `gkm deploy --provider dokploy` | alpha.62 | `--target dokploy` (or nothing: `dokploy` is the default) | Works, prints `--provider is deprecated; use --target dokploy.` on stderr |
| `gkm deploy --provider docker` | alpha.62 | `gkm docker`, or `gkm compose` / `--target compose` | Already fails with `ProviderRemoved` |
| `gkm deploy --provider aws-lambda` | alpha.62 | `deploy: { default: 'sst' }` and `gkm deploy --stage <stage>` | Already fails with `ProviderRemoved` |
| `gkm deploy --skip-push`, `--skip-build` | alpha.60 | `--dry-run` to change nothing; `gkm compose --tag` to release what CI pushed | Accepted and ignored: `gkm deploy` no longer reads them |

When `--provider` goes, the `ProviderRemoved` error and the `targetForProvider`
mapping go with it. The flag will be unknown, and commander reports that itself.

### Functions and types

These live in `@geekmidas/cli`'s source under `src/deploy/` and are not part of
a public entry point (`@geekmidas/cli/deploy` exports `deploy()`). Only code that
deep-imports the CLI's internals, or its own tests, can reach them.

| Deprecated | Since | Use instead |
|---|---|---|
| `workspaceDeployCommand(workspace, options)` | alpha.60 | `deploy({ cwd, stage })` from `@geekmidas/cli/deploy` |
| `deployCommand(options)` | alpha.60 | `deploy({ cwd: process.cwd(), stage })` |
| `DeployOptions` (with `provider`, `skipPush`, `skipBuild`) and `DeployProvider` (`'docker' \| 'dokploy' \| 'aws-lambda'`) | alpha.60 | `DeployInput` |
| `DockerDeployResult.masterKey` (the result of building one image) | alpha.55 | The key is set in the container's runtime environment by the deploy. `gkm build --stage` writes it to `.gkm/server/master.key`; read it from there. |
| `export * from '../target/dokploy/engine'` in `src/deploy/index.ts` | next alpha | `src/target/dokploy/engine` |

`BuildResult.masterKey` (returned by the build command) goes with
`DockerDeployResult.masterKey`, so no result object carries the stage's master
key.

### Re-export shims at the old engine paths

The Dokploy engine moved from `src/deploy/` to `src/target/dokploy/`, beside the
target that runs it. Each old file is now a one-line re-export:

| Old path | New path |
|---|---|
| `src/deploy/dokploy-api.ts` | `src/target/dokploy/dokploy-api.ts` |
| `src/deploy/domain.ts` | `src/target/dokploy/domain.ts` |
| `src/deploy/declared.ts` | `src/target/dokploy/declared.ts` |
| `src/deploy/fromManifest.ts` | `src/target/dokploy/fromManifest.ts` |
| `src/deploy/env-resolver.ts` | `src/target/dokploy/env-resolver.ts` |
| `src/deploy/backup-provisioner.ts` | `src/target/dokploy/backup-provisioner.ts` |
| `src/deploy/dns/index.ts` | `src/target/dokploy/dns/index.ts` |
| `src/deploy/dns/DnsProvider.ts` | `src/target/dokploy/dns/DnsProvider.ts` |
| `src/deploy/dns/Route53Provider.ts` | `src/target/dokploy/dns/Route53Provider.ts` |
| `src/deploy/dns/HostingerProvider.ts` | `src/target/dokploy/dns/HostingerProvider.ts` |
| `src/deploy/dns/hostinger-api.ts` | `src/target/dokploy/dns/hostinger-api.ts` |

None of these is a package entry point, so removing them changes nothing for a
project that imports only `@geekmidas/cli/*` subpaths. The CLI's own tests that
still import through the old paths move to the new ones in the same change.

## What stays

These look like compatibility code but are not on the removal list:

- **`gkm login --service` and `gkm logout --service`**: deprecated in favour of
  `--provider`, but kept on purpose so CI scripts that use them keep working.
  Not a deploy shim.
- **v1 state migration**: a v1 state file is still migrated on first read. See
  [Deploy state](./state.md#migrating-from-v1).
- **A custom `StateProvider`**: still accepted, behind a store that warns
  `StateStoreWithoutLocking`.
- **The old stage-key location**: a key at `~/.gkm/<folder>/<stage>.key` is
  still copied to `~/.gkm/keys/<namespace>/<project>/<stage>.key` the first time
  it is read.

## Checking a project

```bash
# Scripts and workflows that still pass the old flags
grep -rnE "gkm deploy.*(--provider|--skip-push|--skip-build)" \
  package.json .github/ scripts/ 2>/dev/null

# Code that deep-imports the CLI's deploy internals
grep -rnE "@geekmidas/cli/(dist|src)/deploy" --include='*.ts' .
```

The scaffolded GitHub workflow already runs `gkm deploy --stage "$STAGE"` with
no `--provider`.
