# Deploy State

Deploy state records what a stage's deploys created, so the next deploy finds
it again instead of creating it twice, and who did each of them. Every target
keeps each app's releases; the Dokploy target also keeps its project,
environment, application and domain ids, the database services and their
per-app credentials, generated secrets and the registry. What a deploy creates
outside the target, such as DNS records, is kept as a resource record.

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
second machine deploying the same stage does not see it. It then
finds the Dokploy project by its [ownership marker](./deployment.md#identity-namespace-project-stage)
rather than by id. Use a remote provider as soon as more than one place deploys.
In CI, local state is refused: see [Deploying from CI](#deploying-from-ci).

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
- Use for: teams, and **anything deployed from CI** (recommended)

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

## The document

Each stage's state is one JSON document, schema version 3. `state` is the
target's shape, told apart by `provider`. A compose stage's holds nothing
beyond what every target records:

```json
{
  "schemaVersion": 3,
  "stage": "production",
  "serial": 12,
  "state": {
    "provider": "compose",
    "stage": "production",
    "lastDeployedAt": "2026-10-09T09:14:02.511Z",
    "identity": "acme/shop",
    "releases": {
      "api": {
        "current": {
          "ref": "ghcr.io/acme/shop-api:v1.4.0",
          "tag": "v1.4.0",
          "digest": "sha256:9f2c…",
          "releasedAt": "2026-10-09T09:13:58.020Z",
          "releasedBy": {
            "kind": "github",
            "actor": "octocat",
            "run": "https://github.com/acme/shop/actions/runs/11223344",
            "workflow": "Deploy"
          }
        },
        "previous": { "ref": "ghcr.io/acme/shop-api:v1.3.2", "…": "…" },
        "history": ["…"]
      }
    }
  },
  "resources": {
    "dns-record:api.shop.example.com:A": {
      "key": "dns-record:api.shop.example.com:A",
      "type": "dns-record",
      "id": "api.shop.example.com A",
      "status": "ready",
      "data": {
        "domain": "shop.example.com",
        "name": "api",
        "value": "203.0.113.10",
        "ttl": 600,
        "provider": "godaddy"
      },
      "updatedAt": "2026-10-09T09:12:40.118Z",
      "updatedBy": { "kind": "github", "actor": "octocat", "run": "…" }
    }
  },
  "updatedAt": "2026-10-09T09:14:02.511Z",
  "updatedBy": { "kind": "github", "actor": "octocat", "run": "…" },
  "history": [
    { "serial": 12, "at": "2026-10-09T09:14:02.511Z", "by": { "kind": "github", "…": "…" }, "operation": "deploy" },
    { "serial": 9, "at": "2026-10-08T16:40:11.002Z", "by": { "kind": "local", "user": "ada", "host": "ada-laptop" }, "operation": "state:push" }
  ]
}
```

A Dokploy stage's `state` is `provider: "dokploy"` with its ids beside the same
`releases`.

### Who wrote it

Every write is stamped with who made it:

- in GitHub Actions (`GITHUB_ACTIONS=true`): `{ kind: 'github', actor, run, workflow }`,
  from `GITHUB_ACTOR`, `GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_RUN_ID` and
  `GITHUB_WORKFLOW`;
- anywhere else: `{ kind: 'local', user, host }`.

It is kept as the document's `updatedBy`, on every resource record
(`updatedBy`) and on every release (`releasedBy`). `history` keeps the last 20
runs that wrote the stage, newest first: a run is one entry however many
writes it makes, named after the lock it held (`deploy`, `rollback`,
`state:push`, `state:pull`, …).

```bash
gkm state:history --stage production
# History of stage production (newest first):
#   12 · 2026-10-09T09:14:02.511Z · octocat (Deploy, https://github.com/acme/shop/actions/runs/11223344) · deploy
#   9 · 2026-10-08T16:40:11.002Z · ada@ada-laptop · state:push
#
# Releases:
#   api: ghcr.io/acme/shop-api:v1.4.0 (sha256:9f2c…) · 2026-10-09T09:13:58.020Z · octocat (Deploy, …)
gkm state:history --stage production --json
```

### DNS records

A DNS record gkm wrote for the stage is the resource
`dns-record:<fqdn>:<type>`, its `id` `<fqdn> <type>` and its value, TTL and
provider in `data`. One gkm deleted is forgotten. Whether the stage's hosts
point at its server is checked on every compose deploy, not remembered.

## Deploying from CI

A CI runner is discarded when its job ends, and `.gkm/` with it: a deploy that
kept its state there leaves the next run nothing to roll back to and no record
of what was created. So in CI (`GITHUB_ACTIONS=true` or `CI=true`), a deploy or
`gkm deploy:rollback` of a deployed stage whose state is local fails at the
start, before anything is built or changed:

```
LocalStateInCi: `gkm deploy` would keep stage 'production's deploy state in
.gkm/ on this CI runner, and the runner is discarded when the job ends: …
Keep the state in AWS — in gkm.config.ts:

  state: { provider: 'ssm', region: 'eu-west-1' },

then move the state you already have, from the machine that holds it:

  gkm state:push --stage production
```

`gkm state:push` copies the laptop's state, migrated to the current schema on
the way, into the new store. The role `gkm deploy:github` creates for a compose
stage is allowed to read and write the stage's state parameters
(`/gkm/<workspace>/<stage>/*`, the lock included) when `state.provider` is
`ssm`, and the stage's objects under the prefix when it is `s3`. The local
stage, and local state outside CI, are unaffected.

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
(`deploy`, `rollback`, `state:push`, …), which is also what `history` names. A run cancelled through its `AbortSignal`, or one that
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
gkm state:history --stage production         # who wrote it, newest first; --json too
gkm state:unlock --stage production          # release a crashed run's lock
```

`state:pull`, `state:push` and `state:diff` need a remote provider. A push takes
the remote stage's lock, so it fails with `StateLocked` while a deploy of that
stage is running, rather than replacing the state the deploy is writing. Copies
are conditional writes, and resource records travel with the state.

## Migrating from earlier versions

Nothing needs to be done to migrate.

**Version 2** wrapped the state with its resource records and a write counter,
but every target wrote the Dokploy shape. Reading a v2 document, a state whose
every Dokploy-only field is empty — no project or environment id, no
application or service ids, credentials, generated secrets, backups or
registry — was written by compose: it is read as the compose shape, its
`dnsRecords` become `dns-record` resources (with no `provider`, which v2 did
not record), and `dnsVerified` and the empty Dokploy fields are dropped. The
rule is the content, not the workspace's configured target, because a document
reads the same wherever it is read (`state:show`, `state:push`) and a stage can
change targets; and it loses nothing, since only empty fields go. A state with
any Dokploy id is read exactly as it was. Either way the document is written as
version 3, gaining `updatedBy` and `history`, by the next write — reading alone
changes nothing.

**Version 1** was the bare state object. The first time any command reads one,
it

1. keeps the original as a backup: `.gkm/deploy-<stage>.v1.json` locally,
   `/gkm/<workspace>/<stage>/state.v1` in SSM, `state.v1.json` beside the S3
   object. An existing backup is never replaced;
2. seeds a `ready` resource record for every id v1 kept (project, environment,
   applications, Postgres, Redis, backup destination), so the next deploy adopts
   them;
3. writes the state back as version 3, as above.

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
  read(stage: string): Promise<{ state; resources; history; version } | null>;
  write(stage, state, { expectedVersion }): Promise<StateVersion>;           // null: must not exist yet
  putResource(stage, record, { expectedVersion }?): Promise<StateVersion>;
  deleteResource(stage, key, { expectedVersion }?): Promise<StateVersion>;
}
```

`StateStore` is exported as a type from `@geekmidas/cli/target`. `StateLocked`,
`StateVersionConflict`, `LocalStateInCi` and the `Actor` type are exported from
`@geekmidas/cli/deploy`.
