---
'@geekmidas/cli': minor
---

:boom: `gkm deploy` deploys through a `DeployTarget`; `--provider docker` and `--provider aws-lambda` are removed

- **`@geekmidas/cli/target`.** A target implements `validate → plan` (a dry run) or `validate → provision → build → release → verify`, plus `rollback` when its `capabilities` say it can. Each phase gets the `DeployIdentity`, the workspace and manifest, an explicit `cwd`, the `CredentialProvider`, the stage's `StateStore` (locked for a real run), the stage's secrets (masked in every line once read), a logger, the `AbortSignal`, an event emitter and `name()` for namespaced resource names. A target declares its `runtime` (`server` | `aws`), `capabilities` (`rollback`, who runs `migrations`, whether it builds `images`), an `options` schema (any Standard Schema) and the `credentials` it asks for. `defineTarget()` infers the options and run-state types. `CredentialKinds` can be augmented for a target's own credentials.
- **Config.** `deploy.default` (and an app's `deploy`) accepts any target name. `deploy.targets` maps names to a package, a target object, or `[package or target, options]`; a built-in's name cannot be taken. A package declares `"gkm": { "runtime": … }` in its `package.json`, which `gkm dev` and `gkm build` read without loading it.
- **Resolution.** The host's targets (`deploy({ targets })`), then the built-ins, then `deploy.targets`; anything else is `UnknownDeployTarget`. A package is never guessed from a name. `sst`, `vercel` and `cloudflare` raise `DeployTargetNotYetSupported`.
- **`gkm deploy --target <name>`.** `--provider dokploy` still works as `--target dokploy`, with a deprecation warning. `--provider docker` and `--provider aws-lambda` raise `ProviderRemoved`, pointing to `gkm docker`/`gkm compose` and SST. Scaffolded deploy scripts are `gkm deploy --stage <stage>`.
- **Dokploy is the built-in `dokploy` target**, with unchanged requests and output. Its image builds stay in `release`, beside each application.
- **Events.** `phase.failed`, `health.checked`, and the `build` and `rollback` phases are new; `deploy.started` carries `target`. `deploy.started` is emitted once the target has validated. `NoDeployableApps` names the target. `DeployProviderUnsupported` is gone. `providerOf` reads each target's declared runtime and no longer treats `deploy.default: 'server'` as a target.
