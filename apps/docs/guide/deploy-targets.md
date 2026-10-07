# Deploy Targets

`gkm deploy` deploys a stage through a **target**. The target decides what a
deploy creates, how it builds the apps, how it puts them live and how it checks
them. The rest of a deploy is the same for every target: the config is loaded in
a [sandbox](./sandbox.md), the stage's [state](./state.md) is locked, progress
is reported as [events](./deploy-api.md#events), and missing credentials stop
the run before anything changes.

Three targets ship with the CLI:

| Target | Runs on | Runtime | Rollback | Migrations | Builds images | Local stage |
|---|---|---|---|---|---|---|
| `dokploy` | a [Dokploy](https://dokploy.com) server | `server` | yes | applied by the target | yes | no |
| `compose` | the machine that runs the deploy (Docker Compose + Caddy) | `server` | no | applied by the target | yes | yes |
| `sst` | AWS, through [SST](https://sst.dev) | `aws` | no | applied in the stack | no | no |

Any other target is a package the project installs and names in
`deploy.targets`; see [Writing a target](./writing-a-target.md).

## Choosing a target

- **`dokploy`** is the default. Use it when you run your own server (or several)
  with Dokploy on it. It provisions Postgres, MinIO and pg-boss for what the
  workspace declares, builds and pushes one image per app, deploys backends
  before sites, waits for each deployment, health-checks every app and rolls
  back what fails. Details: [Dokploy deployment](./deployment.md#dokploy-deployment).
- **`compose`** brings a stage up as one Docker Compose stack behind Caddy on
  the machine that deploys. Use it for a single VM, a preview box, or to run
  the production images locally. It is the only target that can also deploy
  the project's local stage. Details: [Deploy with Docker Compose](./compose.md).
- **`sst`** deploys to AWS. It runs `gkm build --provider aws` and
  `sst deploy`, then health-checks each surface URL the stack returns. SST
  keeps no previous release, so a failed check is not rolled back. Details:
  [AWS with SST](./deployment.md#aws-with-sst).

The target also chooses the **runtime**, which decides the backends `gkm dev`
and `gkm build` pick: a `server` runtime puts events on pg-boss and keeps
caches in the database; an `aws` runtime uses SNS/SQS, S3 and Upstash. So
choosing a target is a project decision, not just a deploy flag.

`vercel` and `cloudflare` are reserved names. A deploy through either fails
with `DeployTargetNotYetSupported`.

## Configuring it

```ts
// gkm.config.ts
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  stages: { local: 'dev', deployed: ['staging', 'production'] },
  constructs: './constructs/**/*.ts',
  deploy: {
    default: 'dokploy',            // 'dokploy' when left out
    registry: 'ghcr.io/acme',      // read by every target that builds images
    domains: { production: 'shop.example.com', staging: 'staging.shop.example.com' },
    dokploy: { endpoint: 'https://dokploy.example.com' },
  },
});
```

- `deploy.default` is the target every app deploys through.
- An app's own `deploy` overrides it for that app. A deploy through one target
  skips the apps that deploy through another, and says so (`app.skipped`).
- `deploy.registry` is where images are pushed and pulled from, for every
  target. An image is `<registry>/<namespace>/<project>-<app>:<tag>`.
  `deploy.dokploy.registry` was moved here; a config that still sets it fails
  with `DokployRegistryMoved`.
- `deploy.domains` is each deployed stage's base domain, for every target.

## `--target`

```bash
gkm deploy --stage production                   # deploy.default
gkm deploy --stage production --target compose  # this run only
gkm deploy --stage dev --target compose         # the local stage, compose only
```

`--target` picks a target for one run. Apps that follow the default deploy
through it; apps whose own `deploy` names another target are skipped.

`--provider` is the flag from before targets. `--provider dokploy` still works
as `--target dokploy` and prints a deprecation warning. `--provider docker` and
`--provider aws-lambda` fail with `ProviderRemoved`: use `gkm docker` or
`gkm compose` for the first, and the `sst` target for the second. See the
[removal plan](./deploy-deprecations.md).

## `deploy.targets`

A target that does not ship with the CLI is installed as a dependency of the
workspace root and named under `deploy.targets`. The key is the name
`deploy.default`, an app's `deploy`, or `--target` uses.

```ts
import { defineTarget } from '@geekmidas/cli/target';

export default defineWorkspace({
  // …
  deploy: {
    default: 'acme',
    targets: {
      acme: '@acme/gkm-target',                  // a package; its default export is the target
      fly: ['@acme/gkm-fly', { org: 'acme' }],   // a package, with options
      scratch: defineTarget({ /* … */ }),        // a target object
    },
  },
});
```

Options are validated by the target's own `options` schema before any phase
runs. Invalid options fail with `InvalidTargetOptions`, listing each issue. A
target that takes no options and is given some fails the same way.

A target object written inline in `gkm.config.ts` is a live object, so it works
under the default local sandbox but not under an isolating one
(`ConfigObjectNotSerializable`). Packages work under both.

## How a name is resolved

The first of these that has the name wins:

1. **The host's own targets.** A program calling
   [`deploy({ targets })`](./deploy-api.md) can supply its own implementation
   of any name, `dokploy` included.
2. **The built-ins:** `dokploy`, `compose`, `sst`.
3. **`deploy.targets`** in `gkm.config.ts`.

A name none of them has fails with `UnknownDeployTarget`, listing the names that
would have worked.

Built-ins come before the config so that a dependency listed under the name
`dokploy` cannot take over the built-in. There is deliberately no fourth step
that guesses a package from a name (`acme` → `@acme/gkm-target`). An npm scope
nobody has claimed can be claimed by anyone, and the deploy would then run
their code with the stage's credentials. A target is always installed and named.

Before a package is imported, its `package.json` must declare the runtime it
deploys to (`"gkm": { "runtime": "server" }`). A package that does not fails
with `TargetRuntimeUndeclared`, and none of its code runs. See
[Writing a target](./writing-a-target.md#declaring-the-runtime).

## Credentials per target

A deploy never prompts below the CLI. It asks a `CredentialProvider` for each
credential it needs, and stops with `MissingCredential` (naming what was missing
and how to supply it) when nothing has it. `gkm deploy` at a terminal prompts
for the Dokploy and registry logins; with `--json`, or without a terminal, it
does not.

| Target | Credential kinds | From the environment |
|---|---|---|
| `dokploy` | `dokploy`, `registry` (only when Dokploy has no registry for `deploy.registry`) | `DOKPLOY_API_TOKEN`, `DOKPLOY_ENDPOINT` (or `deploy.dokploy.endpoint`), `DOCKER_REGISTRY_USERNAME`, `DOCKER_REGISTRY_PASSWORD`; else the login `gkm login` stored |
| `compose` | none | images are pulled with the machine's own `docker login` |
| `sst` | `aws` | `AWS_PROFILE` alone when it is set; otherwise `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` |

The SST target hands the AWS credential to `sst deploy` only. The build and
every other sandboxed step run without any `AWS_*` variable.

## See also

- [Writing a target](./writing-a-target.md)
- [`deploy()` from a program](./deploy-api.md)
- [Deploy state](./state.md)
- [Running in production](./production.md)
