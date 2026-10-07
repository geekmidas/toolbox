# Deploy State

Deploy state records what a stage's deploys created, so the next deploy finds
it again instead of creating it twice. It holds the Dokploy project,
environment, application and domain ids, the database services and their
per-app credentials, generated secrets, DNS records, the registry, and each
app's releases.

`state.provider` in `gkm.config.ts` picks where it lives. Every deploy, every
`gkm deploy:rollback` and every `gkm state:*` command goes through the same
store.

::: warning State holds secrets
Database passwords, generated secrets and backup IAM keys are in the state.
Local state files are written with mode `0600`; SSM state is a `SecureString`.
`gkm state:show` masks all three.
:::

## Providers

### Local (the default)

```ts
state: { provider: 'local' }   // or leave `state` out
```

- State: `.gkm/deploy-<stage>.json`
- Lock: `.gkm/deploy-<stage>.lock`
- Use for: one person deploying from one machine

`.gkm/` is gitignored, so local state does not travel with the repository. A
second machine, or a CI job, deploying the same stage does not see it. It then
finds the Dokploy project by its [ownership marker](./deployment.md#identity-namespace-project-stage)
rather than by id. Use a remote provider as soon as more than one place deploys.

### SSM

```ts
export default defineWorkspace({
  name: 'shop',                 // required: state is keyed by workspace name
  // …
  state: {
    provider: 'ssm',
    region: 'eu-west-1',
    profile: 'acme-prod',       // optional; the default credential chain otherwise
  },
});
```

- State: `/gkm/<workspace>/<stage>/state`, a `SecureString` encrypted with the
  AWS-managed KMS key
- Lock: `/gkm/<workspace>/<stage>/lock`, created only if absent
- Read and written in SSM directly; there is no local copy to go stale
- Use for: teams and CI on AWS

SSM has no conditional put, so a write checks the parameter's version before
and after it.

### S3

```ts
state: {
  provider: 's3',
  bucket: 'shop-deploy-state', // must already exist
  region: 'eu-west-1',
  prefix: 'gkm',               // optional, default 'gkm'
  profile: 'acme-prod',        // optional
},
```

- State: `s3://<bucket>/<prefix>/<workspace>/<stage>/state.json`
- Lock: `lock.json` beside it
- Every write is conditional (`If-None-Match: *` to create, `If-Match: <etag>`
  to replace), so two runs can never overwrite each other
- Use for: teams and CI that already have a bucket, or that keep state out of SSM

SSM and S3 both need the workspace `name`. Without it they fail with
`StateStoreNeedsWorkspaceName`.

### A custom store

`state.provider` can also be an object:

- a **`StateStore`** (the interface below) is used as is;
- a **`StateProvider`**, an object with only `read(stage)` and
  `write(stage, state)`, still works but cannot lock. Every deploy warns
  `StateStoreWithoutLocking`, because two deploys of the stage can overwrite
  each other.

A custom store is a live object in the config, so it works under the default
local sandbox but fails with `ConfigObjectNotSerializable` under an
[isolating sandbox](./sandbox.md#isolating-sandboxes).

## Locks

A deploy takes the stage's lock before it generates, provisions or records
anything, and holds it until the run ends, however it ends. A second deploy of
the same stage, from another CI job or a laptop, fails at once with
`StateLocked`:

```
Deploy state for stage 'production' is locked by ci@runner-7 (pid 4121) since
2026-10-01T09:12:44.000Z for 'deploy' (/gkm/shop/production/lock). Wait for that
run to finish; if it crashed, release the lock with
`gkm state:unlock --stage production`.
```

The lock records who holds it: user, host, pid, when, and the operation
(`deploy`, `rollback`). A run cancelled through its `AbortSignal`, or one that
fails, releases it. A dry run takes no lock, so it never blocks a real deploy.

### `gkm state:unlock`

A process killed outright (`SIGKILL`, a runner that disappeared) cannot release
its lock. Release it by hand:

```bash
gkm state:unlock --stage production
# Released the lock on stage production, held by ci@runner-7 (pid 4121) since …
```

It removes the lock whoever holds it, and prints who that was. Check that run is
really gone first: releasing the lock of a live run lets a second run race it.

## Versions and conflicts

Every read returns a version: a content hash for local files, the parameter
version for SSM, the ETag for S3. Every write names the version it was based on.
If the stored state has moved on since, the write fails with
`StateVersionConflict` instead of silently replacing what another run wrote.
Local files are replaced atomically (temporary file, then rename).

## The journal: surviving a crash

A deploy writes state as it goes, not once at the end. For every resource it
creates (project, environment, each application and domain), it writes a
record:

1. `pending`, before the call that creates the resource;
2. `ready`, with the target's id, once the call has returned.

A run that dies part way leaves behind the id of everything it got back. The
next run looks up anything still `pending` before creating it, so it adopts
what the dead run made instead of making a second one. `resource.applied`
events say how each resource was found: `recorded`, `resumed`, `found` or
`created`.

`gkm state:show` lists the resources still pending.

## Releases

Each app's releases are recorded under `releases`:

```ts
releases: {
  api: {
    current:  { ref: 'ghcr.io/acme/shop-api:production-1759…', tag: '…', digest: 'sha256:…', releasedAt: '…' },
    previous: { ref: '…', releasedAt: '…' },   // what a rollback restores
    history:  [ /* newest first, at most 10 */ ],
  },
}
```

The Dokploy target's automatic rollback and `gkm deploy:rollback` use `previous`.
A release that was rolled back is marked `rolledBack: true` and is never rolled
back to. See [Running in production: rollback](./production.md#rollback).

## Commands

```bash
gkm state:show   --stage production          # ids, releases, pending resources (secrets masked)
gkm state:show   --stage production --json
gkm state:pull   --stage production          # copy the remote stage to .gkm/
gkm state:push   --stage production          # copy the local stage to the remote
gkm state:diff   --stage production          # compare local and remote, records included
gkm state:unlock --stage production          # release a crashed run's lock
```

`state:pull`, `state:push` and `state:diff` need a remote provider. A push takes
the remote stage's lock, so it fails with `StateLocked` while a deploy of that
stage is running, rather than replacing the state the deploy is writing. Copies
are conditional writes, and resource records travel with the state.

## Migrating from v1

State is stored as schema version 2: the stage's state, wrapped with its
resource records and a write counter:

```json
{
  "schemaVersion": 2,
  "stage": "production",
  "serial": 14,
  "state": { "provider": "dokploy", "stage": "production", "projectId": "…" },
  "resources": { "application:api": { "key": "application:api", "type": "application", "id": "…", "status": "ready", "updatedAt": "…" } },
  "updatedAt": "…"
}
```

Version 1 was the bare state object. Nothing needs to be done to migrate: the
first time any command reads a v1 state, it

1. keeps the original as a backup: `.gkm/deploy-<stage>.v1.json` locally,
   `/gkm/<workspace>/<stage>/state.v1` in SSM, `state.v1.json` beside the S3
   object. An existing backup is never replaced;
2. seeds a `ready` resource record for every id v1 kept (project, environment,
   applications, Postgres, Redis, backup destination), so the next deploy adopts
   them;
3. writes the state back as version 2.

A state written by a newer CLI than the one reading it fails with
`StateSchemaTooNew`; upgrade `@geekmidas/cli`. A state file that is not valid
JSON fails with `StateUnreadable`. Restore it from a backup (or SSM's parameter
history, or S3 versioning) rather than deploying without it: a deploy without
state recreates every resource.

Releases recorded before the Dokploy target learned to roll back (an `images`
map) are not carried over. The first deploy after upgrading starts each app's
`releases`, and rollback is available from the second.

## The `StateStore` interface

For a custom store, or a [target](./writing-a-target.md) reading `ctx.state`:

```ts
interface StateStore {
  lock(stage: string, options?: { operation?: string }): Promise<StateLock>; // or StateLocked
  forceUnlock(stage: string): Promise<LockHolder | null>;
  read(stage: string): Promise<{ state; resources; version } | null>;
  write(stage, state, { expectedVersion }): Promise<StateVersion>;           // null: must not exist yet
  putResource(stage, record, { expectedVersion }?): Promise<StateVersion>;
  deleteResource(stage, key, { expectedVersion }?): Promise<StateVersion>;
}
```

`StateStore` is exported as a type from `@geekmidas/cli/target`. `StateLocked`
and `StateVersionConflict` are exported from `@geekmidas/cli/deploy`.
