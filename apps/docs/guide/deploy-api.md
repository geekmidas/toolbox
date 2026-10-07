# Deploying from a Program

`gkm deploy` is a thin wrapper around `deploy()` from `@geekmidas/cli/deploy`.
A host can call it directly: a CI runner, a platform that deploys its users'
repositories, or a script. `deploy()` never prompts, never prints and never
exits the process. You tell it where the project is and hand it credentials,
and it gives you back a run: events to read while it goes, and a result at the
end.

```ts
import { deploy } from '@geekmidas/cli/deploy';

const run = deploy({
  cwd: '/srv/checkouts/shop',   // the project; never assumed to be process.cwd()
  stage: 'production',
  credentials: {
    async get(request) {
      if (request.kind === 'dokploy') {
        return { endpoint: 'https://dokploy.example.com', token: vault.dokploy };
      }
      return undefined;
    },
  },
  signal: AbortSignal.timeout(30 * 60_000),
});

for await (const event of run) {
  forward(event);               // plain JSON; see "Events" below
}

const result = await run.result; // or rejects: MissingCredential, StateLocked, …
```

The run starts as soon as `deploy()` is called. Reading the events is
optional, and a loop that starts late still sees every event from the first.
A caller that only reads events learns of a failure from the `deploy.failed`
event; awaiting `result` rejects with the error itself.

## Input

| Option | Default | What it does |
|---|---|---|
| `cwd` | required | The directory holding `gkm.config.ts`, or any directory inside it. |
| `stage` | required | A deployed stage, or the local stage through a target that can run one (`compose`). |
| `target` | `deploy.default`, else `dokploy` | The [target](./deploy-targets.md) to deploy through, by name. |
| `targets` | none | Your own targets, by name. Consulted before the built-ins and `deploy.targets`. |
| `tag` | the target's `tag()`, else `<stage>-<timestamp>` | The image tag, or whatever label the target releases under. |
| `apps` | all | Deploy only these apps (in dependency order). |
| `dryRun` | `false` | Report what would happen as `resource.planned` events. Takes no lock, writes no state, generates no secrets, builds and pushes nothing. |
| `atomic` | `false` | When a release or its verification fails, roll back every app the run released, not only the failed ones (on a target that can roll back). |
| `credentials` | environment, then `gkm login` | Where credentials come from. See [Credentials](#credentials). |
| `logger` | none | Receives each progress line, as `gkm deploy` would print it. Anything with `info` and `warn` (and optionally `error`), such as a `@geekmidas/logger` `Logger`. |
| `signal` | none | Stops the run. See [Cancelling](#cancelling). |
| `home` | `GKM_HOME`, else `~/.gkm` | The CLI's home: stage keys and stored logins. |
| `childOutput` | `'inherit'` | Where docker's own output goes: `'inherit'`, `'stderr'` or `'ignore'`. |
| `sandbox` | a `LocalSandbox` on the project | Where the project's own code runs. See [The sandbox](./sandbox.md). |

## Events

Every event is a plain JSON object with a `type`. Nothing in an event is a class
instance, a function or a secret. An error travels as `{ name, message }`. Log
lines are masked: any secret the run has read is printed as `***`.

| `type` | Fields | When |
|---|---|---|
| `deploy.started` | `stage`, `target`, `identity`, `tag`, `apps`, `dryRun` | Once `validate` has passed |
| `phase.started` / `phase.finished` | `phase` | Around each phase |
| `phase.failed` | `phase`, `error` | A phase threw. `deploy.failed` follows, after a rollback if there is one |
| `log` | `level` (`info`, `warn`, `error`), `message` | Each progress line, exactly as the terminal prints it |
| `app.skipped` | `app`, `reason` | An app left out: a mobile app, another target's app |
| `resource.planned` | `key`, `resourceType`, `action`, `id?` | Dry run: what would be created (`create`), reused (`reuse`) or looked up and created if missing (`ensure`) |
| `resource.applied` | `key`, `resourceType`, `action`, `id`, `via` | A resource used. `via`: `recorded`, `resumed`, `found` or `created` |
| `artifact.built` | `app`, `imageRef`, `digest?` | An image built (and pushed) |
| `app.deployed` | `app`, `applicationId`, `imageRef`, `url` | An app is live |
| `app.failed` | `app`, `error` | An app failed |
| `health.checked` | `app`, `url`, `healthy`, `status?`, `attempt` | One health check of a released app |
| `deploy.finished` | `result` | The run finished. `result` is the `DeployResult` |
| `deploy.failed` | `error` | The run stopped. Always the last event of a failed run |

The phases are `validate`, `plan`, `provision`, `build`, `release`, `verify`
and `rollback`. A dry run has only `validate` and `plan`.

The union only grows. A new event is a new `type`, a new field is optional, and
nothing that exists changes meaning. That is why events carry no version
number. Ignore types you do not know.

The types are exported: `DeployEvent`, `DeployEventType`, `DeployPhase`,
`DeployEventError`, `ResourceChange` and `ResourceVia`.

## Result

`run.result` resolves with a `DeployResult`:

```ts
interface DeployResult {
  stage: string;
  identity: string;        // '<namespace>/<project>'
  tag: string;
  dryRun: boolean;
  projectId: string;       // the target's project, where it has one
  environmentId: string;   // empty when a dry run would create it
  apps: AppDeployResult[]; // { appName, type, success, applicationId?, imageRef?, digest?, url?, error? }
  successCount: number;
  failedCount: number;
  skipped: { app: string; reason: string }[];
  urls: Record<string, string>;
  changes: ResourceChange[]; // every resource touched, in order (or planned, for a dry run)
}
```

It is plain JSON, so it can be written out as is.

## `gkm deploy --json`

The CLI's `--json` flag writes each event as one JSON object per line on stdout,
ending with `deploy.finished` (whose `result` is the `DeployResult`) or
`deploy.failed`:

```bash
gkm deploy --stage production --json | jq -c 'select(.type == "app.deployed")'
```

With `--json`:

- stdout carries the events and nothing else. Docker's own output goes to
  stderr, and so does the deprecation warning for `--provider`.
- Nothing prompts. A missing credential fails the run with `MissingCredential`.
- The exit code is `0` when the run finished and `1` when anything stopped it.

`--dry-run` works with or without `--json`. It shows what a deploy would create
or reuse and changes nothing.

## Credentials

A deploy asks a `CredentialProvider` for each credential it needs. When the
provider returns `undefined`, the run stops with `MissingCredential`, naming
what was missing and how to supply it. Nothing below `gkm deploy` asks a person.

```ts
import {
  chainCredentials,
  storedCredentials,
  type CredentialProvider,
  type CredentialRequest,
} from '@geekmidas/cli/deploy';

const fromVault: CredentialProvider = {
  async get(asked) {
    // `get` is generic in the kind; the union narrows on `kind`.
    const request = asked as CredentialRequest;
    switch (request.kind) {
      case 'dokploy':
        return { endpoint: vault.dokployEndpoint, token: vault.dokployToken };
      case 'aws':
        return { profile: `deploy-${request.stage}` };
      default:
        return undefined;
    }
  },
};

deploy({
  cwd,
  stage: 'production',
  // The vault first, then the environment and `gkm login`.
  credentials: chainCredentials(fromVault, storedCredentials()),
});
```

| Kind | Asked for with | Answer | `storedCredentials()` reads |
|---|---|---|---|
| `dokploy` | `endpoint?` (`deploy.dokploy.endpoint`) | `{ endpoint, token }` | `DOKPLOY_API_TOKEN`, `DOKPLOY_ENDPOINT`, then the login `gkm login` stored, then the config's endpoint |
| `registry` | `url` (`deploy.registry`) | `{ username, password }` | `DOCKER_REGISTRY_USERNAME`, `DOCKER_REGISTRY_PASSWORD` |
| `aws` | `stage` | `{ profile, region? }` or `{ accessKeyId, secretAccessKey, sessionToken?, region? }` | `AWS_PROFILE` alone when set; else `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`; region from `AWS_REGION` or `AWS_DEFAULT_REGION` |

The `registry` login is asked for only when Dokploy has no registry for
`deploy.registry` and one has to be created. An `aws` answer is a profile or
keys, never both: given both, every AWS SDK takes the keys, so a profile for
production could be overridden by staging keys left in the environment.

`storedCredentials({ env, home })` reads a different environment or CLI home.
Stored logins are in `<home>/credentials.json`.

Credentials never enter the [sandbox](./sandbox.md). They go from the provider
to the steps that provision, push and release.

## Cancelling

```ts
const controller = new AbortController();
const run = deploy({ cwd, stage: 'production', signal: controller.signal });

process.once('SIGTERM', () => controller.abort(new Error('runner stopping')));
```

Aborting cancels in-flight Dokploy requests and docker children, releases the
stage's lock, and makes `result` reject with the signal's reason. A stopped
run is not rolled back. Deploy again to finish it: every phase picks up what
the previous run made.

## Running more than one deploy

Two deploys can run in one process. Each run's log lines, sandbox and events
are its own. Two deploys of the **same stage** cannot run at once, wherever
they run: the second fails with `StateLocked`, naming who holds the lock. See
[Deploy state](./state.md#locks).

Give every job its own CLI home on a shared runner, so jobs do not share stored
logins or stage keys:

```ts
deploy({ cwd, stage, home: `/var/lib/deployer/${jobId}/gkm` });
```

or set `GKM_HOME` for the `gkm` process.

## Errors

Every failure is a named error class exported from `@geekmidas/cli/deploy`.
Match on the class or on `error.name` (which is what events carry), not on the
message.

| Error | Means |
|---|---|
| `MissingCredential` | A credential no provider had. `kind` says which. |
| `StateLocked` | Another run holds the stage's lock. `holder` says who. |
| `StateVersionConflict` | The stage's state changed under this run. |
| `ProjectNotOwned` | A Dokploy project with the deploy's name exists but was not created by this workspace's identity. |
| `RegistryNotConfigured`, `RegistryNotFound`, `RegistryAmbiguous` | `deploy.registry` is missing, or Dokploy's registry for it cannot be pinned down. |
| `UnknownDeployTarget`, `DeployTargetNotYetSupported`, `ProviderRemoved` | The target name does not resolve. |
| `TargetPackageNotFound`, `TargetPackageInvalid`, `TargetRuntimeUndeclared`, `TargetRuntimeMismatch`, `TargetEntryInvalid`, `InvalidTargetOptions` | A `deploy.targets` entry is wrong. |
| `UnknownDeployApps`, `NoDeployableApps` | `apps` names an app that does not exist, or nothing deploys through this target. |
| `MissingEnvVars` | An app reads variables the stage does not provide. |
| `BackendDeployFailed`, `FrontendDeployFailed` | A Dokploy release failed. |
| `DeploymentFailed`, `DeploymentTimedOut`, `HealthCheckTimedOut` | Dokploy's deployment failed or an app never became healthy. |
| `DeployMigrationsFailed` | The stage's migrations failed. |
| `RollbackFailed` | A release failed, and so did rolling it back. Both errors are on it. |
| `SstConfigNotFound`, `SstOutputsUnreadable`, `SurfacesUnhealthy` | The SST target's checks failed. |
| `ConfigLoadFailed`, `ConfigObjectNotSerializable`, `ConstructDiscoveryFailed`, `ConstructsNotSerializable`, `SandboxWorkerFailed` | The project's code could not be loaded in the sandbox. |

## Rolling back from a program

`rollbackStage` is what `gkm deploy:rollback` runs. It puts a Dokploy stage's
apps back on the image they ran before:

```ts
import { rollbackStage } from '@geekmidas/cli/deploy';

const rolledBack = await rollbackStage({
  cwd,
  stage: 'production',
  app: 'api',            // or atomic: true for every app with an earlier release
  credentials,
  log: (line) => logger.info(line),
});
// [{ app: 'api', from: { ref, tag, digest }, to: { ref, tag, digest } }]
```

It fails with `RollbackNeedsApp` when neither `app` nor `atomic` is given,
`NothingToRollBack` when the app has no earlier release, and
`StageNeverDeployed` when the stage has no state. See
[Running in production: rollback](./production.md#rollback).
