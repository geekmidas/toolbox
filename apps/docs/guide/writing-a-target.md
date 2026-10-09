# Writing a Target

A deploy target is an object with a few phases. `gkm deploy` and
[`deploy()`](./deploy-api.md) call them in order, and handle everything that is
the same for every target: loading the config, choosing the apps, working out
the [identity](./deployment.md#identity-namespace-project-stage), taking the
stage's lock, reporting phases as events, and rolling back when a release
fails.

Everything you need is in `@geekmidas/cli/target`. Importing it loads no deploy
engine: it is the interface, `defineTarget`, and the errors resolution raises.

```bash
pnpm add -D @geekmidas/cli
```

## A minimal target

```ts
// src/index.ts of @acme/gkm-target
import { defineTarget } from '@geekmidas/cli/target';
import { z } from 'zod';

export default defineTarget({
  name: 'acme',
  runtime: 'server',
  capabilities: { rollback: true, migrations: 'target', images: true },
  credentials: ['dokploy'],
  options: z.object({ region: z.string().default('ams') }),

  async validate(ctx) {
    // Check everything before anything changes. What you return is `run`.
    return { region: ctx.options.region, released: [] as string[] };
  },

  async plan(ctx, run) {
    for (const app of ctx.apps) {
      ctx.emit({
        type: 'resource.planned',
        key: `app:${app}`,
        resourceType: 'app',
        action: 'ensure',
      });
    }
  },

  async release(ctx, run) {
    for (const app of ctx.apps) {
      // … put the app live under ctx.name(app) …
      run.released.push(app);
      ctx.emit({
        type: 'app.deployed',
        app,
        applicationId: ctx.name(app),
        imageRef: `registry.example.com/${ctx.name(app)}:${ctx.tag}`,
        url: `https://${app}.example.com`,
      });
    }
  },

  async rollback(ctx, run, failure) {
    ctx.logger.warn(`Rolling back after ${failure.phase} failed`);
    // … point each released app back at its previous release …
  },

  result(ctx, run) {
    return {
      stage: ctx.stage,
      identity: ctx.identity.key,
      tag: ctx.tag,
      dryRun: ctx.dryRun,
      projectId: '',
      environmentId: '',
      apps: run.released.map((appName) => ({
        appName,
        type: 'backend',
        success: true,
      })),
      successCount: run.released.length,
      failedCount: 0,
      skipped: [...ctx.skipped],
      urls: {},
      changes: [],
    };
  },
});
```

`defineTarget` does nothing at runtime. It types the target from what it is
written with: `ctx.options` from the `options` schema, and `run` from what
`validate` returns.

## Phases

| Phase | Required | Runs | Job |
|---|---|---|---|
| `validate(ctx)` | yes | always | Check the config, apps and credentials, and work out what the run would do. Returns the run state handed to every later phase. A build-only run calls it too, so check here only what building needs. |
| `ready(ctx, run)` | no | deploy and dry run, never a build | What only this target checks before a deploy changes anything — compose's server address and DNS. Runs after `validate`. |
| `plan(ctx, run)` | yes | dry run only | Emit `resource.planned` for what a real run would do. Change nothing. |
| `provision(ctx, run)` | no | real run | Create or find what the apps run on, and what the workspace declares. |
| `build(ctx, run)` | no | real run | Build each app's artifact (`artifact.built`) without changing anything live. |
| `release(ctx, run)` | yes | real run | Put the artifacts live (`app.deployed`). |
| `verify(ctx, run)` | no | real run | Check that what was released answers (`health.checked`). |
| `rollback(ctx, run, failure)` | no | after a failed `release` or `verify` | Restore the previous release. Called only when `capabilities.rollback` is `true`. |
| `result(ctx, run)` | yes | at the end | Return the `DeployResult`. |
| `tag({ cwd, stage })` | no | before `validate`, when no `--tag` was given | The tag this run releases under. Defaults to `<stage>-<timestamp>`. |

A dry run calls `validate`, `ready` and `plan`, takes no lock, and must write
nothing. A real run takes the stage's lock, then calls `validate`, `ready`,
`provision`, `build`, `release` and `verify`, and releases the lock however the
run ends. A build-only run (`buildOnly`) calls `validate` and `build`, and
nothing else.

Before `validate`, every deploy through a `server` target — never a build —
runs the stage's readiness check once, after the stage's providers have
written their keys: a kind the stage set to `false` (`StageProviderDisabled`),
mail and storage keys (`ExternalServicesNotConfigured`, and the dev services
`allowDevServices` stands in, reported once), each provider's `verify()`, stale
`localhost` addresses (`StaleStageSecrets`) and third-party credentials against
their schemas (`CredentialsInvalid`). A target does not repeat them.

If `release` or `verify` throws and the target can roll back, the CLI calls
`rollback` with `{ phase, error }` and then rethrows the original error. If
`rollback` throws too, the run fails with `RollbackFailed`, carrying both
errors. A run stopped through its `AbortSignal` is not rolled back.

**Every phase must be safe to run again.** A deploy that stopped part way is
finished by deploying again, so a phase looks for what an earlier run made
(through `ctx.state`) before making it.

## Capabilities

```ts
capabilities: {
  rollback: boolean,                // rollback() restores the previous release
  migrations: 'target' | 'app',     // who applies database migrations
  images: boolean,                  // builds container images: needs Docker and a registry
  localStage?: boolean,             // can deploy the project's local stage
}
```

Without `localStage: true`, a deploy of the local stage is refused with
`UndeclaredStage`. Only a target that runs on the deploying machine (like the
built-in `compose`) should set it.

## The phase context

Every phase is handed the same `ctx` for the whole run:

| Field | What it is |
|---|---|
| `target` | The name the target was resolved by. |
| `cwd` | The workspace root. Never `process.cwd()`: a host may deploy a checkout somewhere else. |
| `stage`, `tag`, `tagGiven` | The stage, the tag, and whether the tag was asked for (`--tag`) or made up for this run. |
| `apps` | The apps this target deploys, in dependency order. |
| `skipped` | Apps the run leaves out, and why. Add to it with `ctx.skip(app, reason)`. |
| `identity` | `{ namespace, project, stage, key }` for naming and claiming what you create. |
| `workspace`, `manifest` | The normalized workspace and the construct manifest. |
| `options` | Your options, parsed by your `options` schema. |
| `dryRun`, `atomic` | Whether this is a dry run; whether a failed release should roll back every released app, not only the failed ones. |
| `credentials` | The run's `CredentialProvider`. Nothing prompts. |
| `state` | The stage's [`StateStore`](./state.md), locked for a real run. |
| `secrets` | The stage's secrets: `read()`, `write()`, `mask(value)`, and `store` (`'file'`, `'ssm'`, …). |
| `logger` | `info`, `warn`, `error`. Each line becomes a `log` event. |
| `signal` | Fires when the run is stopped. Pass it to every request and child process. |
| `childOutput` | Where the output of commands you spawn should go: `inherit`, `stderr` or `ignore`. |
| `emit(event)` | Report progress. |
| `name(resource)` | The namespaced name of a resource, e.g. `name('api')` is `production-shop-api`. Two workspaces or two stages never share one. |

Every secret read through `ctx.secrets` is masked: a log line that would print
it prints `***`, in the terminal and in the events. Call `ctx.secrets.mask()` for
any other sensitive value you come across, such as a token returned by an API.

## Events

A target emits every event except the run's own (`deploy.*` and `phase.*`),
which the CLI emits around each phase:

- `log` (prefer `ctx.logger`)
- `app.skipped` (prefer `ctx.skip`)
- `resource.planned` and `resource.applied`
- `artifact.built`
- `app.deployed` and `app.failed`
- `health.checked`

The full shapes are in [`deploy()`: events](./deploy-api.md#events). Events are
plain JSON. Never put a credential, a class instance or a function in one.

## Credentials

List the kinds of credential your target asks for in `credentials`, so a host
or `gkm login` can collect them up front. Ask for them in `validate`, and fail
early when one is missing:

```ts
import { MissingCredential } from '@geekmidas/cli/deploy';

async validate(ctx) {
  const dokploy = await ctx.credentials.get(
    { kind: 'dokploy' },
    { signal: ctx.signal },
  );
  if (!dokploy) throw new MissingCredential('dokploy', undefined);
  return { dokploy };
}
```

The CLI knows three kinds: `dokploy`, `registry` and `aws`. A target that needs
another declares it by augmenting `CredentialKinds`:

```ts
declare module '@geekmidas/cli/target' {
  interface CredentialKinds {
    fly: { request: { org: string }; value: { token: string } };
  }
}
```

The default provider (environment variables, then `gkm login`) cannot answer a
kind it does not know. A host passes a provider that can, and `MissingCredential`
explains how to supply it otherwise.

Keep credentials out of the [sandbox](./sandbox.md). The project's own code (its
config, its build) runs there. A credential belongs only in the step that needs
it, the way the `sst` target hands AWS keys to `sst deploy` and to nothing else.

## Declaring the runtime

A target package says which runtime it deploys to in its `package.json`:

```json
{
  "name": "@acme/gkm-target",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "gkm": { "runtime": "server" }
}
```

`gkm dev` and `gkm build` choose a project's backends by the runtime (pg-boss
and database caches on `server`; SNS/SQS, S3 and Upstash on `aws`). They read it
on every start and must not import a deploy plugin to do so. A plugin may pull in
a cloud SDK, and a broken one would stop `gkm dev` for a project that is only
being developed.

- A package without `gkm.runtime` (or with a value other than `server` or `aws`)
  fails with `TargetRuntimeUndeclared`, before any of its code runs.
- A package whose target's `runtime` differs from the declared one fails with
  `TargetRuntimeMismatch`.
- A package whose default export is not a target fails with
  `TargetPackageInvalid`.
- A package that is not installed fails with `TargetPackageNotFound`.

The package is found from the workspace root's `node_modules`, the way the
project would import it. It is not found from the CLI's own location or the
process's working directory.

## Resolution order

`deploy.default`, an app's `deploy` and `--target` name a target. The first of
these that has the name wins:

1. the host's own targets: `deploy({ targets: { … } })`
2. the built-ins: `dokploy`, `compose`, `sst`
3. `deploy.targets` in `gkm.config.ts`

Why this order, and why there is no lookup by naming convention:

- **The host first**, so a platform calling `deploy()` can run its own
  implementation of any target, including `dokploy`.
- **Built-ins before the config**, so a dependency listed under the name
  `dokploy` cannot replace the built-in.
- **No guessing a package from a name.** Turning `acme` into `@acme/gkm-target`
  and importing it would be convenient, but an npm scope nobody has claimed can
  be claimed by anyone. The deploy would then run their code with the stage's
  credentials. So a target is always installed and named explicitly.

## Testing a target

Call it through [`deploy()`](./deploy-api.md) with the target passed as a host
target, so nothing has to be published or installed:

```ts
import { deploy } from '@geekmidas/cli/deploy';
import acme from '../src';

const run = deploy({
  cwd: fixtureWorkspace,
  stage: 'staging',
  target: 'acme',
  targets: { acme },
  dryRun: true,
  credentials: { async get() { return undefined; } },
});

const events = [];
for await (const event of run) events.push(event);
await run.result;
```
