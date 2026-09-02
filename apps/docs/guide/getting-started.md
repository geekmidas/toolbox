# Getting Started

::: info Version
This is the documentation for **next** — the line where the constructs paradigm
lands. For the released line, see [v9](https://geekmidas.github.io/toolbox/).
:::

## Prerequisites

- Node.js >= 22.0.0
- pnpm >= 10.13.1
- Docker (for the local containers `gkm` derives from your constructs)

## Install the CLI

```bash
pnpm add -g @geekmidas/cli
```

## Create a New Project

```bash
gkm init my-project
```

---

## The Model: Everything Is a Construct

The thing worth learning first isn't a command — it's what changed underneath
them.

A **construct** is one declaration in your application code that stands for a
piece of infrastructure. A bucket, a database, a cache, a third-party
credential, an API surface, a topic, a queue. You write it once, and three
different consumers derive what they need from that one line:

| Derived | By whom | When |
|---------|---------|------|
| The function's **environment** | the framework | `gkm build` |
| Its **runtime client** | the framework | first request |
| The **infrastructure** — a container locally, a resource deployed | the target adapter | `gkm dev` / `gkm deploy` |

Before, each of those was written by hand, in a different file, and the only
thing holding them together was a string literal typed three times:

```ts
// ❌ the old shape — a bucket declared three times
// 1. app code: a hand-written Service reading UPLOADS_NAME
// 2. sst.config.ts: new Storage(stack, 'uploads'), links, envVars
// 3. gkm config: services: { storage: true } → a minio container
```

```ts
// ✅ now — one line, and all three derive from it
export const uploads = new ObjectStorage('Uploads');
```

Rename the construct and every consumer moves with it, because there is no
string to keep in step.

::: tip Read the design
The full argument — the dependency edge, why triggers aren't dependencies, why
permissions are the adapter's business and not the manifest's — is in
[Constructs Paradigm](/guide/constructs-paradigm).
:::

---

## 1. Declare a Database

```typescript
// src/constructs/database.ts
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import type { Generated } from 'kysely';

export interface Database {
  users: {
    id: Generated<string>;
    name: string;
    email: string;
    created_at: Generated<Date>;
  };
}

export const database = new KyselyDatabase<Database, 'Example'>('Example');
```

That single statement replaces what used to be a hand-written `Service`, a
`services: { db: true }` entry in the config, and a `DATABASE_URL` nobody could
trace back to a container. It declares the logical database, its schema, the
owner/runtime role split, and the Postgres major version — read by the local
target as a container tag and by the AWS target as the RDS engine version, so
the two can't drift apart the way they used to.

::: warning Both type arguments or neither
TypeScript has no partial type-argument inference, so
`new KyselyDatabase<Database>('Example')` leaves the name at `string` and widens
the service key. Pass both.
:::

Point the config at it:

```typescript
// gkm.config.ts
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  // One glob, every kind of resource. A declared ObjectStorage would never be
  // found by `routes:` or `crons:` — resources have no kind to be listed under.
  constructs: './src/constructs/**/*.ts',
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env#envParser',
  logger: './src/config/logger',
  runtime: 'node',
  openapi: true,
});
```

Now run:

```bash
gkm dev
```

Reconcile reads the glob, inspects every export of every matching module, and
asks one structural question — *does it have an id, and can it declare?* From
the answer it starts a Postgres container, creates the database, applies the
roles and the schema, and injects `EXAMPLE_URL` before your server starts.
Nothing lists `postgres` anywhere. **The construct is why a Postgres exists at
all.**

::: info Structural, not `instanceof`
A construct from a linked workspace or a second copy in the lockfile is still a
construct. `instanceof` is exactly the check that would say otherwise.
:::

## 2. Use It From an Endpoint

```typescript
// src/endpoints/router.ts
import { e } from '@geekmidas/constructs/endpoints';
import logger from '../config/logger';
import { database } from '../constructs/database';

export const router = e
  .logger(logger)
  .database(database)
  .authorizer('iam');
```

```typescript
// src/endpoints/users.ts
import { z } from 'zod';
import { router } from './router';

export const getUsers = router
  .get('/users')
  .output(z.object({ users: z.array(z.object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
  })) }))
  .handle(async ({ db }) => {
    const users = await db.selectFrom('users').selectAll().execute();
    return { users };
  });
```

`db` is typed from the construct's schema. The execution wrapper opens the
transaction and puts it in the handler context — including the RLS context when
you configure one.

## 3. Depend On Things: `.dependsOn()`

`.dependsOn()` takes **constructs**, records the edge, and dissolves each
construct's client into the handler's services under the construct's own id:

```typescript
// src/constructs/uploads.ts
import { ObjectStorage } from '@geekmidas/constructs/object-storage';

export const uploads = new ObjectStorage('Uploads', { versioned: true });
```

```typescript
// src/endpoints/avatars.ts
import { uploads } from '../constructs/uploads';

export const createAvatarUpload = router
  .post('/avatars')
  .body(z.object({ contentType: z.string(), contentLength: z.number() }))
  .dependsOn([uploads])
  .handle(async ({ body, services }) => {
    // services.uploads exists and types *because of* the .dependsOn above
    return services.uploads.getUploadURL({
      path: `avatars/${crypto.randomUUID()}`,
      contentType: body.contentType,
      contentLength: body.contentLength,
    });
  });
```

From that one edge: the handler's env gets `UPLOADS_URL` at build, its client is
bound on the first request, and the deploy target grants exactly the S3 access
this function named — and nothing else. **Permissions are not a framework
concept and are not in the manifest.** The manifest records what is depended on;
what that implies on a given cloud belongs to the adapter.

::: warning `.dependsOn()` takes constructs only
A `Service` (`{ serviceName, register }`) doesn't match the shape. That's what
keeps environment sniffing confined to the legacy `.services()` path instead of
leaking back into the new one.
:::

---

## The Construct Catalogue

Everything below is real today. `import { X } from '@geekmidas/constructs/…'`:

| Construct | Import | Handler gets | Local | Deployed |
|---|---|---|---|---|
| `KyselyDatabase` | `/database/kysely` | `db` — a typed Kysely client | Postgres container | RDS |
| `ObjectStorage` | `/object-storage` | `StorageClient` — write, presign | MinIO | S3 |
| `FileServer` | `/file-server` | storage client **plus** `url()` / `signedUrl()` | MinIO | S3 + CDN |
| `Cache` | `/cache` | `CacheClient` | Redis / Postgres table | Upstash, ElastiCache, or the database |
| `Credential` | `/credential` | the parsed, validated value | injected secret | secret manager |
| `Email` | `/email` | a sender, typed by your templates | Mailpit | SES, Resend, or SMTP |
| `Topic` | `/topic` | `topic.publisher` — a typed publisher | pg-boss / RabbitMQ / LocalStack | SNS |
| `Queue` | `/queue` | `send()` | pg-boss / RabbitMQ / LocalStack | SQS |
| `RestApi` | `/rest-api` | — (a surface) | the dev server | API Gateway |
| `StaticSite` | `/site` | — (a surface) | the dev server | CDN |
| `BetterAuth` | `/auth` | the auth server | container | provisioned |

Thirteen declaration kinds in total. **The local target reconciles all
thirteen; the AWS target provisions twelve** — `rest-api` is the one still
outstanding. See [what is outstanding](https://github.com/geekmidas/toolbox/blob/main/docs/design/constructs-outstanding.md).

### Derived constructs

A database isn't only a database. The derived forms come off the parent, so the
parent's id comes from the parent instead of from a string somebody has to keep
in step:

```typescript
export const database = new KyselyDatabase<Database, 'Example'>('Example');

export const replica = database.reader();       // ExampleReader — read-only role
export const cache = database.cache();          // ExampleCache — a cache in this DB
export const acme = database.schema<TenantDB, 'Acme'>('Acme');  // its own role and URL
database.owner;                                 // the DDL role, for migrations
```

`reader()` is enforced by the reader role's grants, not by which endpoint it
reaches — which is why it stays correct even where a stage runs a single
instance and the reader resolves to the writer's address.

### Credentials have a shape

A **secret** is generated and rotated by the platform and is one opaque string.
A **credential** is issued by someone else, arrives with several fields, and is
worth validating on the way in:

```typescript
import { Credential } from '@geekmidas/constructs/credential';

export const stripe = new Credential('Stripe', {
  schema: z.object({ secretKey: z.string(), webhookSecret: z.string() }),
});

// in a handler — no await, already fetched and validated at registration
.dependsOn([stripe])
.handle(async ({ services }) => services.stripe.secretKey)
```

A malformed or half-set credential fails when the process starts, not on the
first request that needs the one field somebody forgot.

---

## Triggers Are Not Dependencies

A **trigger** is what causes a function to run. A **dependency** is what it
consumes while running. Keeping them apart is what lets a subscriber need no
permission on its topic at all — the subscription is created at deploy, and at
runtime it only reads its own queue.

```typescript
// A topic: the event contract, and a derived typed publisher
import { Topic } from '@geekmidas/constructs/topic';

export const users = new Topic('users', {
  'user.created': z.object({ userId: z.string(), email: z.email() }),
});
```

```typescript
// A subscriber — bound to the topic, granted nothing on it
import { s } from '@geekmidas/constructs/subscribers';

export const sendWelcome = s
  .topic(users)
  .subscribe(['user.created'])
  .dependsOn([email])
  .handle(async ({ events, services }) => { /* … */ });
```

```typescript
// A queue worker — one queue, one consumer, one construct
import { q } from '@geekmidas/constructs/queue';

export const processOrder = q
  .queue('orders')
  .message(z.object({ orderId: z.string() }))
  .dependsOn([database])
  .handle(async ({ message, services }) => { /* … */ });
```

```typescript
// A schedule
import { c } from '@geekmidas/constructs/crons';

export const dailyReport = c
  .schedule('cron(0 6 * * *)')   // or rate(1 day)
  .dependsOn([database, uploads])
  .handle(async ({ services }) => { /* … */ });
```

Publishing is the only side that needs the topic's connection string, so only
the producer gets it — `.publisher(users.publisher)` on the factory, or
`.dependsOn([users])` where a handler publishes directly.

---

## Secrets and Credential Injection

`gkm init` bootstraps encrypted secrets for the `development` stage:

```
my-project/
├── .gkm/secrets/development.json   # encrypted — safe to commit
├── gkm.config.ts
└── src/constructs/
```

The decryption key lives outside the repo at
`~/.gkm/my-project/development.key` and never enters source control.

`gkm dev` and `gkm exec` decrypt and inject before your app code runs, via a
preload that sets `globalThis.__gkm_credentials__`:

```typescript
// src/config/env.ts
import { EnvironmentParser } from '@geekmidas/envkit';
import { Credentials } from '@geekmidas/envkit/credentials';

export const envParser = new EnvironmentParser({
  ...process.env,
  ...Credentials,
});
```

`Credentials` resolves in priority order:

1. `globalThis.__gkm_credentials__` — set by the `gkm dev` / `gkm exec` preload
2. Build-time decryption via `GKM_MASTER_KEY` — CI/CD and Docker builds
3. An empty object

::: tip You need this less than you used to
Anything a construct provides — a database URL, a bucket URL, a cache endpoint —
is derived and injected from the declaration. `EnvironmentParser` is for what's
genuinely yours to configure, and `Credential` is for third-party values with a
shape. Reach for a raw env key when neither fits.
:::

Managing them:

```bash
gkm secrets:set STRIPE_KEY sk_test_xxx --stage development
gkm secrets:show --stage development
gkm secrets:rotate --stage development
gkm secrets:init --stage production
```

---

## Running Locally

```bash
gkm dev                    # reconcile containers from constructs, then serve
gkm exec -- pnpm db:migrate # one-off command with secrets injected
gkm test                   # tests, with containers and secrets
```

Each project's containers are scoped to that project, so two `gkm dev` sessions
in two repos don't collide on ports or credentials.

---

## Build and Deploy

`gkm build` writes the **manifest** — the seam between build and run. It records
every declaration and every edge; what a given cloud does with them is the
target adapter's business.

```bash
gkm build --provider server --production
gkm docker
gkm deploy --stage production
```

::: warning Deploy is not yet proven end to end
The AWS target provisions twelve of the thirteen kinds and its decisions are
unit-tested as pure functions, but **a stack has never come up**. `rest-api` on
AWS is outstanding. The Dokploy/server path is the one to use today.
:::

---

## Coming From v9

Nothing stops working. Four things are on notice, all warn-and-honour:

| Deprecated | Replacement |
|---|---|
| `.services([dbService])` with a hand-written `Service` | `.dependsOn([construct])` |
| Per-kind globs (`routes`, `crons`, `subscribers`) | one `constructs` glob |
| `q.queue(name)` | `new Queue(name)` |
| Workspace `services: { db, cache, mail }` | the constructs that imply them |

`services.cache`, `services.mail`, and `services.events` keep a narrower job —
naming the *backend* (`'upstash' | 'elasticache' | 'db'`, `'ses' | 'resend' |
'smtp'`, `'pgboss' | 'sns' | 'rabbitmq'`) rather than declaring that a resource
exists.

`export const e` still works and gains a surface named `api`, which matches the
current single-gateway behaviour.

---

## Next Steps

- [Constructs Paradigm](/guide/constructs-paradigm) — the full design
- [@geekmidas/constructs](/packages/constructs) — every builder, in detail
- [CLI Reference](/guide/cli-reference) — all `gkm` commands
- [Development Server](/guide/dev-server) — how reconcile and hot-reload work
- [Testing](/guide/testing) — testing endpoints, queues, and subscribers
- [Deployment](/guide/deployment) — production deployment
