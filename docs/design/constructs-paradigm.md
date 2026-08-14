# Constructs Paradigm: Everything Is a Construct

- **Status**: Draft
- **Impact**: High — changes the core model of `@geekmidas/constructs`, `@geekmidas/manifest`, `@geekmidas/cli`, and `@geekmidas/cloud`
- **Breaking**: Nothing stops working. Four deprecations are planned, all warn-and-honour with removal no earlier than a later major: `.services([…])`, the per-kind config globs, `s`/`q.queue()`, and the workspace `services: { db, cache, mail }` block.

## Overview

Today a **construct** means *a function-shaped thing that gets deployed* — an
`Endpoint`, `Cron`, `Function`, `Subscriber`, or `Queue` — plus one outlier,
`Topic`. Everything **stateful** an app depends on (a bucket, a database, a
cache, a secret) isn't a construct at all. It's declared separately, three times
over, in three places that agree only by string convention.

This proposal makes **everything a construct**, and introduces one primitive
tying them together: the **dependency edge**. From a single edge the framework
derives a function's environment and its runtime binding; a target adapter
separately derives cloud access at deploy. Application code becomes the source
of truth for infrastructure, and the **manifest** becomes the seam between build
and run.

> Declare a thing once, in code. The runtime client, the deployed
> infrastructure, and the local dev container all derive from that declaration.

## Problem Statement

### 1. Every resource is declared three times

| Concern | Where | How |
|---|---|---|
| Runtime client | app code | a hand-written `Service` reading `UPLOADS_NAME`, building an `AmazonStorageClient` |
| Deployed infra | `sst.config.ts` | `new Storage(stack, 'uploads')` + `links: [uploads], envVars: ['UPLOADS_NAME']` |
| Local infra | `gkm` workspace config | `services: { … }` → a `minio` container in the generated compose file |

The only thing holding them together is the literal string `UPLOADS_NAME`, typed
by hand in each. Rename the bucket and nothing fails at compile time.

### 2. Environment is inferred, not declared

Because resources are opaque hand-written `Service`s, the build can't know what
config a function needs — so it runs the service to find out.
[`Construct.getEnvironment()`](https://github.com/geekmidas/toolbox/blob/main/packages/constructs/src/Construct.ts#L102-L166)
calls each `service.register()` against a `SnifferEnvironmentParser` and a fake
`ServiceContext`, recording which keys get touched.

The machinery it needs is the tell: a noop context, a module-level cache keyed
by service object (because singletons short-circuit on the second `register()`),
`sniffWithFireAndForget` to swallow background rejections, and a `catch` that
logs and **returns `[]`** — so a service that throws early yields an empty env
list and a green build.

### 3. The manifest can't describe infrastructure

[`Manifest`](https://github.com/geekmidas/toolbox/blob/main/packages/manifest/src/index.ts)
has `routes`, `functions`, `crons`, `subscribers`, `queues`, `topics` — six
kinds of *function*, zero kinds of *resource*. It can say what code to run, not
what to provision. That gap is why `sst.config.ts` still hand-declares buckets.

### 4. Provider words leak into a provider-neutral layer

`queues` means SQS. `topics` means SNS. `subscribers` carries
`transport?: 'topic' | 'queue'`. AWS transport names sitting in what should be a
portable contract.

### 5. Packages are coupled to things you don't use

`@geekmidas/constructs` marks every `@geekmidas/*` peer optional, but two levels
below that it still binds:

```ts
// packages/constructs/src/Construct.ts:1-11
import type { AuditStorage } from '@geekmidas/audit';
import { SnifferEnvironmentParser, sniffWithFireAndForget }   // ← VALUE import
  from '@geekmidas/envkit/sniffer';
import type { EventPublisher, MappedEvent } from '@geekmidas/events';
```

The **root export has a runtime dependency** on envkit, so importing even
`ConstructType` resolves it. And the base is generic over **nine** type
parameters — logger, event publisher, output schema, services, audit storage and
its service name, database and its service name — so merely naming the type
requires `audit`, `events`, `logger`, `services`, and `@standard-schema/spec`
installed, whether or not you audit or publish anything.

### 6. The pattern is already here, ungeneralized

`Topic` and `Queue` already **derive** their producer-side `Service` rather than
making you write one — name is the source of truth, env key computed from it,
client derived. This proposal is largely: do that for everything, and make the
derivation visible to the build instead of only to the runtime.

## The Model

### One interface, not a base class

```ts
export interface Construct<TName extends string = string, TClient = never> {
  readonly id: TName;
  declare(): Declaration[];
  readonly service: [TClient] extends [never] ? never : Service<TName, TClient>;
}

export namespace Construct {
  export type Infer<C> = C extends Construct<any, infer T> ? T : never;
  export type Name<C>  = C extends Construct<infer N, any> ? N : never;
  export function ref<C extends Construct>(id: Name<C>): C;
  export function fromService<S extends Service>(service: S): Construct<…>;
}
```

An **interface**, so `Endpoint`, `Cron`, `Queue`, and `Topic` satisfy it without
inheritance surgery, `fromService` can return a plain object, and `.dependsOn()`
gets enforcement structurally — a `Service` (`{ serviceName, register }`) simply
doesn't match `{ id, declare, service }`, with no `instanceof` anywhere. Statics
come from declaration merging.

A construct is simultaneously an infrastructure **requirement** (build time), a
runtime **capability**, and something other code can **consume**. That forces
exactly three members: `declare()`, `id`, and `service`.

### The existing constructs are not special

`Endpoint`, `Cron`, `Function`, `Subscriber`, `Queue`, and `Topic` conform to
the same interface as everything else, in Phase 1 — not as a late retrofit. If
the interface can't express `Endpoint` (session, authorizer, audits, RLS, output
schema), it's the wrong interface, and that's worth learning before four
resources are built on it.

### `declare()` returns a discriminated union

```ts
type Node = { id: string; provides?: string[]; requires?: string[] };
type Fn   = Node & { handler: string; dependencies: Dependency[] };

export type Declaration =
  | Node & { kind: 'objects';  versioned?: boolean }
  | Node & { kind: 'database'; engine?: 'postgres' }
  | Node & { kind: 'cache' }
  | Node & { kind: 'table' }
  | Node & { kind: 'secret' }
  | Node & { kind: 'topic'; events: string[];         subscribers: (Fn & { events: string[] })[] }
  | Node & { kind: 'queue'; fifo?: boolean;           worker: Fn }
  | Node & { kind: 'rest-api';
             authorizers: string[];      // names only — resolved by the cloud implementation
             endpoints: (Fn & { method: HttpMethod; path: string; authorizer: string })[] }
  | Fn   & { kind: 'cron'; schedule: string }
  | Fn   & { kind: 'function' }
  | Node & { kind: 'none' };                          // a `fromService` lift
```

A discriminated union gives exhaustiveness *and* per-kind fields, so there is
no `ConstructType` enum to keep in sync and no shape that carries fields
belonging to a different kind. `declare()` **returns** its declarations rather
than writing into a mutable builder passed in — a value is easier to test and
compose than a visitor.

Triggered functions **nest inside the surface that triggers them**, so there is
no `trigger` field — position carries it. `Fn` is the shared shape for anything
with a handler; `Node` for anything without.

`declare()` returns an **array**, since discovery emits each construct
independently and the build assembles children into their parent.

### Triggers are not dependencies

- **Trigger** — what causes a function to run: a schedule, an HTTP route, a
  queue, a topic subscription.
- **Dependency** — what it consumes while running.

Keeping them distinct removes the queue worker's self-edge, makes topic fan-out
need no machinery, and explains an IAM asymmetry that would otherwise look
arbitrary: a subscriber needs **no permission on the topic at all** — the
subscription is created at deploy and at runtime it only reads its own queue.
Only the *publisher* edge yields `sns:Publish`.

### One construct, one service — the address it owns

`.service` is the **address the construct owns**. A construct contributing
several declarations still has exactly one.

| construct | owns | `.service` |
|---|---|---|
| `ObjectStorage` | a bucket | `StorageClient` |
| `Database` | a connection | request-scoped connection |
| `Cache` | an endpoint | cache client |
| `Topic` | the topic | `publish()` |
| `Queue` | the queue URL | `send()` |
| `Function` | an ARN | typed invoker |
| `RestApi` | a URL | typed caller |
| `Subscriber` | **nothing** — binds to another's topic | — |
| `Cron` | **nothing** — fired by a schedule | — |

The trigger-side half is never consumable: you can't call a queue worker, you
send to its queue. With `TClient = never`, `.dependsOn([dailyReport])` is a
compile error rather than a stub that throws.

### The edge is the one primitive

Because functions are consumable too, the edge covers both `function → resource`
and `function → function`:

```ts
.dependsOn([uploads])     // → S3 access + UPLOADS_URL
.dependsOn([sendEmail])   // → lambda:InvokeFunction + SEND_EMAIL_URL
```

From one edge, three owners derive three things:

| Derived | By whom | When |
|---|---|---|
| the function's **env** | the framework | `gkm build` |
| its **runtime binding** | the framework | first request |
| **cloud access** (IAM) | the target adapter | `gkm deploy` |

**Permissions are not in the manifest and not a framework concept.** The
manifest records only what is depended on; what that implies on a given cloud is
the adapter's business.

Two constraints follow. **Resources stay leaves** — a resource may not consume
another construct, which keeps the provisioning graph acyclic. And **function
edges can cycle**, so the build needs a cycle check naming the loop.

## Authoring

### A function is authored by whatever triggers it

A **surface** is a construct that owns an address and vends the functions it
triggers.

| trigger | author |
|---|---|
| an API | `api.name('createOrder').post('/orders').handle(…)` |
| a topic | `userEvents.name('sendWelcome').on(['user.created']).handle(…)` |
| a queue | `q.name('processOrder').message(schema).handle(…)` — one worker, so the queue and its worker are one construct |
| a schedule | `c.name('dailyReport').schedule('0 6 * * *').handle(…)` |
| direct invoke | `f.name('sendEmail').input(schema).handle(…)` |

**What retires is `s` and `e`** — subscribers are vended by their topic,
endpoints by their API. The other helpers stay: `f` and `c` because their
triggers aren't constructs (a schedule isn't infrastructure, direct invoke isn't
a surface), and `t` and `q` because they create the *surface itself*, which
nothing else vends, and both accumulate configuration.

This makes constraints **unrepresentable rather than enforced**: an endpoint
can't exist without a surface, can't belong to two, and can't subscribe to a
topic it doesn't reference. There is no such thing as an endpoint shared by
`api` and `adminApi` — if two surfaces need the same logic, extract a `Function`
and have both depend on it, which is better anyway since the routes usually
differ in authorizer and response shape.

Back-compat: `export const e = new RestApi('api')` keeps every existing
`e.post('/users')` working, gaining a surface named `api` — which matches the
current single-gateway behaviour. `s` retires and `q.queue(name)` becomes
`new Queue(name)`.

### `.dependsOn([…])` takes constructs only

```ts
.dependsOn([uploads, ordersDb])                 // ✅
.dependsOn([myService])                         // ❌ compile error
.dependsOn([Construct.fromService(myService)])  // ✅ lift it
.services([myService])                          // ⚠️ deprecated
```

It records the edge **and** dissolves each construct's `.service` into the
handler's service record under its `id`. Constructs-only is deliberate: it
confines sniffing to the deprecated `.services()` and the explicit lift, so
retiring `.services()` retires implicit env inference with it — and
`rg fromService` becomes the migration checklist.

`Construct.fromService()` wraps any `Service`: `declare()` contributes a `none`
node, `createClient()` delegates to `register()`, env still sniffed. It's also
the permanent home for dependencies with no infrastructure (a clock, a
formatter), so the graph is complete rather than complete-except-the-boring-ones.

### Identity

**`.name()` on every builder.** Replaces `t.topic(name)` and `q.queue(name)`
(kept as deprecated aliases) and is newly added to `f`, `c`, `e`, which have no
naming method today. It also resolves a live collision — `t.topic()` sets a name
while `s.topic()` binds a subscription target.

**Ids are camelCase and valid JS identifiers** (`^[a-zA-Z][a-zA-Z0-9]*$`). This
matches what ships today: `FunctionGenerator` puts the raw export key
(`sendEmail`) in the manifest, and that *is* the deployed Lambda name. The id is
the service key directly — no case transform, so no paired type-level and
runtime helpers to keep in agreement. `environmentCase` (lodash `snakecase` +
uppercase) yields `SEND_EMAIL`; cloud-specific normalisation (S3 needs
lowercase) is a one-way adapter concern no type depends on.

Names are **explicit**. Inference from the export key can't cover constructs that
read their own name at runtime — enumeration is a build-time capability, and in
Lambda there's no module walk — and inferred names make refactoring a deployment
event. **Renaming an export already renames deployed infrastructure today**; for
a resource that would mean destroy-and-recreate. Explicit names stop a refactor
from being a migration.

## Configuration

### One `<NAME>_URL` per construct; the protocol picks the driver

```ts
const uploads = new ObjectStorage('uploads');
//  id           → 'uploads'
//  config key   → UPLOADS_URL
//  connect(env) → a StorageClient, driver chosen by the URL's protocol
//  aws target   → an S3 bucket, and the adapter writes UPLOADS_URL
```

This generalizes an existing convention rather than inventing one — `Topic` and
`Queue` publishers already read a connection string and select transport by
protocol (`pgboss://` locally, `sns://` deployed). One variable per construct to
inject, rotate, and log.

| `UPLOADS_URL` | client |
|---|---|
| `s3://uploads?region=eu-west-1` | `AmazonStorageClient` |
| `gs://uploads` | `GoogleStorageClient` |
| `s3://uploads?endpoint=http://localhost:9000` | MinIO — same client |

**The cloud is named exactly once, by the thing doing the provisioning.** Never
in application code, never in the construct. The abstraction already exists in
`@geekmidas/storage`: a `StorageClient` interface at the root,
`AmazonStorageClient` behind `./aws`, and a `StorageProvider` enum already
listing `AWSS3 | GCP | AZURE`.

#### The URL contract

This table is the seam between the adapter (which writes the URL) and the client
(which parses it). Both sides implement against it independently, so it has to be
pinned before either is built.

| kind | scheme | shape | notes |
|---|---|---|---|
| `objects` | `s3` / `gs` | `s3://<bucket>?region=<r>` | `?endpoint=` for MinIO |
| `database` | `postgres` | `postgres://<host>:<port>/<db>` | `?secretArn=` when credentials resolve at connect |
| `database` (reader) | `postgres` | same, reader endpoint | separate key — see Open Questions |
| `cache` | `redis` | `redis://<host>:<port>` | Upstash: `rediss://` |
| `table` | `dynamodb` | `dynamodb://<table>?region=<r>` | |
| `queue` | `sqs` / `pgboss` | `sqs://?queueUrl=<url>` | `pgboss://<pg-url>` locally |
| `topic` | `sns` / `pgboss` | `sns://?topicArn=<arn>` | matches today's `Publisher.fromConnectionString` |
| `rest-api` | `https` | `https://<domain>` | custom domain, or the API's own URL |

**Every component of a URL is read off the resource, never from the stack and
never from ambient environment.** A bucket can live in a different region than
the function that reads it, and `AWS_REGION` in a Lambda is the *function's*
region — so omitting `?region=` breaks cross-region silently, at runtime, in the
one deployment where you'd notice last. The same applies to a database's host and
port, a queue's URL, a topic's ARN.

That self-containment is the whole point of the contract: `connect()` builds a
correctly-configured client from the string alone. The moment any part of it is
inherited from context, the URL stops being sufficient.

**The driver is pinned by the build, not a runtime import.** A runtime-computed
specifier can't be bundled — esbuild fails on it, or with a static map includes
every driver, so an S3-only Lambda ships the GCS SDK.

| | driver resolution |
|---|---|
| `gkm build --target=…` | the generated handler imports one driver; esbuild `--alias:`/`--define:` pins it |
| `gkm dev` | resolved at runtime from the protocol; nothing is bundled |

`gkm build` already generates per-construct handlers and already passes
`--define:` for secret injection, so this is a new use of an existing seam.

### Structural in code, stage-varying at deploy

The test for any construct option: *would this value differ between dev and
prod?* If yes, it isn't a construct option.

| in code | at deploy |
|---|---|
| the API exists, its id, that CORS is on | domain, CORS origins |
| an authorizer named `jwt` exists, and its kind | its issuer, audiences |
| the signature scheme (`stripe`) | the signing secret |
| methods, paths, schemas | — |

Consistency with existing machinery, not new work: `AppProps` already carries
`domain`/`hostedZoneId`, the workspace config has a per-stage `domains` map, and
`Route53Provider` resolves zones. It closes at runtime through the same URL rule
— `api.service` reads `API_URL`, so a cron calling the API works against
`localhost:3000` in dev and the real domain in prod with no branch in app code.

### Authorizers

**The construct declares only the names it exposes; the cloud implementation
resolves them.** Local and deployed can legitimately differ — a local JWKS
against a real issuer, a stubbed signature verifier against Stripe's — so
neither the configuration nor the mechanism belongs in portable code.
`.authorizer()` already exists on the endpoint builder and `RouteInfo.authorizer`
is already a name; what changes is that the name is now checked against the
surface that declares it.

This costs nothing at the type level because **an authorizer and a session are
separate concerns**: the authorizer decides whether a request gets through,
`.session()` decides what the handler sees. So a name resolving to different
mechanisms in different environments has no effect on handler types.

**An authorizer is implemented as Hono middleware.** That's the only form
available on every target: API Gateway v1/v2 have native authorizers, Traefik
has ForwardAuth, Cloudflare has Access, Vercel has edge middleware — each
partial, and Traefik's ForwardAuth cannot see the request body, which makes
signature verification unimplementable there. In-process middleware works
everywhere and is bypass-proof, so it is the baseline rather than the fallback.

That matters because `provider: 'server'` is a real production topology, not a
dev convenience — dev and the containerized build run the same process shape. If
authorizers only existed as gateway configuration, every containerized
deployment would ship unauthenticated.

Gateway-native authorizers stay available on `aws`, where they shed traffic
before the Lambda runs. Edge enforcement elsewhere — Traefik ForwardAuth,
Cloudflare Access — is an optimization to add later if it earns its place, not a
prerequisite.

```ts
export const api      = new RestApi('api',      { authorizers: ['jwt', 'iam'], default: 'jwt' });
export const webhooks = new RestApi('webhooks', { authorizers: ['stripe'],     default: 'stripe' });
```

The root `default` is **required** — explicitly `'none'` if that's what's wanted
— so an API meant to be authenticated can't ship open by omission.

There is no separate `WebhookApi`: **a signature check is an authorizer.**
Verifying a Stripe HMAC is authorizing a request with a different scheme, and
modelling it that way removes the raw-body problem too — the authorizer verifies
the unparsed payload before the handler's schema parses it.

### Every API generates a client

`gkm openapi` emits one document today. With authorizers declared per surface,
`securitySchemes` and `endpointAuth` are per-API, so a merged document would be
*wrong*, not merely inconvenient. **Every `rest-api` gets its own spec and
client**, keyed by id — no exceptions, including webhook surfaces, where the
client is what tests drive.

```
.gkm/openapi/api.ts        → paths, endpointAuth, securitySchemes, createApi
.gkm/openapi/webhooks.ts
```

Two consumers, one contract. In-app callers get `api.service` typed directly from
the construct — it vends the endpoint builders, so it knows their types with no
codegen. Out-of-app consumers (a frontend, another app across an API boundary)
use the generated client. Both describe the same surface, so they're testable
against each other.

**A bug this depends on.** `@geekmidas/client`'s `iam` strategy is a silent
auth bypass:

```ts
// packages/client/src/auth-fetcher.ts
case 'iam': {
  // IAM signing requires the full URL and request config … For now, return empty
  return {};
}
```

`AwsSigner.sign(url, init)` is defined correctly and `AuthStrategy` accepts
`{ type: 'iam'; signer }`, but `resolveAuthHeaders(strategy, scheme)` never
receives the url or init — so the branch *can't* sign and returns `{}`.
Configuring a signer type-checks and requests go out unsigned: a 403 if the
endpoint is protected, and quiet success if it isn't.

Plumbing url/init through isn't sufficient. SigV4 signs headers, so signing must
run **last**, over the fully assembled request — including default headers that
must fall inside the signature. Strategies therefore split into two phases:

- **header-producing** (`bearer`, `apiKey`) — contribute headers during assembly
- **request-signing** (`iam`) — an optional `signRequest(url, init)` run once on
  the final request

With that, consumers stop bypassing `createApi` to inject a signing `fetch`, and
the heuristic of sniffing for an `Authorization` header to decide what not to
sign goes away — `endpointAuth` already knows which endpoints are IAM.

### Environment: declaration first, sniffing second

```
env(fn) = ⋃ declaredKeys(c)  for each construct c in .dependsOn()   // exact, static
        ∪ ⋃ sniff(c)         for each `fromService` lift among them // as today
        ∪ ⋃ sniff(s)         for each Service s in .services()      // deprecated
```

The first term is exact. As apps migrate, the sniffed remainder shrinks toward
empty, and the `catch → []` failure stops applying to anything the framework
provides.

## Runtime

### Request-scoped clients

Most clients are singletons; a database client is not — it has to be the current
transaction with RLS applied. That's why `.database()` exists today as a
separate builder method and `db` as a distinguished context slot.

The answer is the one the repo already uses for the logger: a `Proxy` over
`AsyncLocalStorage` that re-resolves per call.

```ts
new Proxy(pool, {
  get: (_t, prop) => {
    const conn = currentConnection() ?? pool;
    const value = Reflect.get(conn, prop);
    return typeof value === 'function' ? value.bind(conn) : value;   // ← bind matters
  },
});
```

The **transaction resolver is the execution wrapper**, not the handler:

```ts
await withRlsContext(pool, extractor(ctx), (trx) =>
  connectionStorage.run({ connection: trx }, () => handler(ctx)),
);
```

Both halves already exist — `withRlsContext` does `set_config` per key, and
`withTransaction` beneath it is re-entrant (`if (db.isTransaction) return cb(db)`).

Three details are load-bearing:

- **Bind methods to the resolved connection.** A method reading a `#` private
  field throws through a proxy; binding to the real target avoids it. We don't
  control Kysely's or Knex's internals.
- **Knex needs an `apply` trap too**, because its instance is callable. Miss it
  and `db.raw(…)` works while `db('orders')` breaks.
- **`db.$pool` escape hatch**, for work that must survive a rollback. Without
  it, people write a second service and the abstraction leaks anyway.

Outside a request it throws, like the logger proxy — better than silently running
on the pool and bypassing RLS.

### `db` stays a first-class slot, typed from the construct

`.database()` is **retargeted, not deprecated**: it takes a construct, records
the edge, and designates the primary database.

```ts
const orders = new KyselyDatabase<OrdersDB>('orders');

api.name('createOrder').post('/orders')
  .database(orders)
  .handle(async ({ db, services }) => {
    await db.selectFrom('orders').selectAll().execute();    // Kysely<OrdersDB>
    await services.orders.selectFrom('orders').execute();   // same object
  });
```

`.database(c)` is `.dependsOn([c])` plus the designation — no second edge. The
schema type flows from the construct to `db` in the handler, `db` in the session
extractor, and `services.orders`, replacing the hand-threaded
`TDatabase`/`TDatabaseServiceName` builder parameters.

The query builder is a construct choice; the provider is not:

```ts
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { KnexDatabase }   from '@geekmidas/constructs/database/knex';
```

**Knex is not at parity.** `@geekmidas/db` has `./kysely`, `./rls` (Kysely-only —
it imports `sql` and `Transaction` from kysely), and `./objection/pagination`,
but **no `./knex` module**. `KnexDatabase` needs one first (a re-entrant
`withTransaction`, a `set_config` `withRlsContext`), so it is a follow-up rather
than parity work. Objection then comes along free: it resolves its connection at
query time via `Model.knex()`, so binding models to the proxy makes
`Order.query()` join the request's transaction with no `trx` argument.

### Services, loggers, and builders

**`register` forwards the whole `ServiceRegisterOptions`.** Cherry-picking
`envParser` silently strips `context` and with it the request-scoped logger.

```ts
this.service = { serviceName: id, register: (options) => this.connect(options) };
```

`ServiceDiscovery` caches by `serviceName`, so `register()` runs **once** per
process. What survives that:

| capture at `register()` | safe? | why |
|---|---|---|
| `context.getLogger()` | ✅ | a proxy that re-resolves per call, including through `child()` |
| `getRequestId()` / `getRequestStartTime()` | ❌ | plain values, frozen to the first request |

Never clone or spread the logger: its proxy target is `{}` with no `ownKeys`
trap, so `{...logger}` yields an empty object silently.

**Constructs never accept or default a logger.** `Topic` and `Queue` currently
hold `DEFAULT_LOGGER = new ConsoleLogger()` at module scope — a process-global
logger with no request correlation, which is exactly the staleness this design
removes. They read `context.getLogger()` instead.

**`.service` is a constructor-assigned field, not a getter.** `Topic.publisher`
is a getter returning a fresh object literal per access, so `serviceEnvCache`
(keyed by object identity) never hits for topic and queue publishers.

**Builders return new instances instead of mutating.** `TopicBuilder` and
`QueueBuilder` mutate `this` and are exported as module singletons, so
`const a = t.topic('a'); const b = t.topic('b')` yields two references to the
same object; `events()` resets state to compensate. `EndpointFactory` already
returns new instances. This matters more once `.dependsOn()` makes
partially-applied builders attractive.

**`private`, not `#`** — the repo uses `private` 848 times and `#` zero times,
and `#` interacts badly with the proxies above.

## Shape of a Construct

```ts
export class ObjectStorage<TName extends string = string>
  implements Construct<TName, StorageClient> {

  readonly service: Service<TName, StorageClient>;
  private readonly config: { url: string };

  constructor(public readonly id: TName, private readonly options: ObjectStorageOptions = {}) {
    this.config = { url: `${environmentCase(id)}_URL` };          // declared ONCE
    this.service = { serviceName: id, register: (o) => this.connect(o) };
  }

  declare(): Declaration[] {
    return [{ kind: 'objects', id: this.id,
              config: Object.values(this.config), ...this.options }];
  }

  private async connect({ envParser, context }: ServiceRegisterOptions) {
    const { url } = envParser
      .create((get) => ({ url: get(this.config.url).string() }))
      .parse();
    return createStorageClient(url, { logger: context.getLogger().child({ construct: this.id }) });
  }
}
```

`declare()` reads `Object.values(this.config)` and `connect()` reads
`this.config.url` — one object, two callers, so declaring a key you don't read is
**unrepresentable** rather than merely unlikely.

## Worked Examples

### Object storage, end to end

```ts
// before — three files coupled by the string UPLOADS_NAME
export const storageService = { serviceName: 'storage', async register({ envParser }) { … } };
export const upload = e.post('/upload').services([storageService]).handle(…);
// + sst.config.ts: new Storage(stack, 'uploads'), links, envVars
// + gkm.config.ts: services: { … } for the local MinIO container

// after
export const uploads = new ObjectStorage('uploads');

export const upload = api.name('upload').post('/upload')
  .dependsOn([uploads])
  .handle(async ({ body, services }) => services.uploads.put(key, body));
// sst.config.ts: nothing — bucket, link, env, and IAM all derive
```

### A queue and its producer

```ts
export const processOrder = q.name('processOrder')
  .message(z.object({ orderId: z.string() }))
  .batchSize(10)
  .dependsOn([ordersDb])
  .handle(async ({ messages, services }) => { … });

export const createOrder = api.name('createOrder').post('/orders')
  .dependsOn([ordersDb, processOrder])
  .handle(async ({ body, services }) => {
    const order = await services.ordersDb.insertInto('orders').values(body)
      .returningAll().executeTakeFirstOrThrow();
    await services.processOrder.send({ orderId: order.id });
    return order;
  });
```

Two declarations from one construct — the queue and its worker — and the
producer consumes only the publisher. The adapter derives asymmetric permissions
from the same resource: `sqs:SendMessage` for `createOrder`,
`ReceiveMessage`/`DeleteMessage` plus the event-source mapping for the worker.

`send()` rather than a callable is deliberate: a `Function`'s client is callable
because it's request/response and returns the output type; a queue send is
fire-and-forget returning `void`. The shape tells you the semantics.

### Topic fan-out

```ts
export const userEvents = t.name('userEvents').events({
  'user.created': z.object({ id: z.string(), email: z.string() }),
  'user.deleted': z.object({ id: z.string() }),
});

export const sendWelcome = userEvents.name('sendWelcome')
  .on(['user.created']).dependsOn([emailer]).handle(async ({ event }) => …);

export const provisionWorkspace = userEvents.name('provisionWorkspace')
  .on(['user.created', 'user.deleted']).dependsOn([ordersDb]).handle(…);
```

Fan-out is "more than one declaration names this topic". Nothing about `Topic`
changes when you add the fifth subscriber. The handler's `event` is the topic's
event union narrowed to the selected keys, so subscribing to an undeclared event
is a compile error.

The adapter gives each subscriber its own SQS queue and DLQ before the Lambda —
one subscriber failing and retrying must not stall the others.

### An auth server

Worth working through because it exercises most of the model at once: an auth
server is **three things simultaneously** — a set of endpoints, a consumer of a
database, and a *producer* of an authorizer.

```ts
const ordersDb = new KyselyDatabase<OrdersDB>('orders');
const authDb   = ordersDb.schema<AuthDB>('auth');        // role + schema tenant

export const auth = new BetterAuth('auth', {
  database: authDb,
  basePath: '/api/auth',
  providers: ['github', 'google'],      // structural; client secrets at deploy
});

export const api = new RestApi('api', { authorizers: [auth], default: auth });
```

`authorizers: [auth]` is the second form of authorizer: a bare name is resolved
externally, while a construct-provided one carries its implementation, its
database dependency, its secrets, and its session typing together.

`.service` is the **server** instance — `services.auth.api.getSession({ headers })`
— matching the rule that consuming a construct gives you the client for the
address it owns. The browser client is the out-of-app consumer, exactly parallel
to `api.service` versus the generated OpenAPI client.

**Schema tenants.** `ordersDb.schema<AuthDB>('auth')` generalizes a pattern
already in the repo: the generated docker init script gives pg-boss a dedicated
role owning its own schema, with `search_path` set on the user and default
privileges applied. That's stronger than a schema qualifier — the app's role has
no grant on `auth`, so it *cannot* read those tables — and the separate type
parameter mirrors the permission boundary, since `OrdersDB` must not contain the
auth tables.

A schema tenant therefore declares a role, a schema, a generated password
secret, provisioning DDL, and a migration set. Three consequences:

- **Role names are cluster-scoped**, schemas are database-scoped. Two apps or
  stages sharing an instance collide on a bare `auth` role, so the role needs
  prefixing while the schema keeps its plain name. The manifest's collision check
  won't catch this — it is per app, and this collides across them.
- **Rotation is two-step.** Changing the stored secret isn't enough;
  `ALTER USER … WITH PASSWORD` has to run against the database too.
- **Migrations must run inside the VPC**, before any dependent function, and in
  order: provision the role and schema, then apply the tenant's own schema. This
  is the one genuinely new capability the design needs — and the same gap that
  leaves pg-boss's role uncreated on a deployed database today.

**Trusted origins derive from the graph.** Better Auth's CSRF check applies to
*every* caller, not just browsers — an API Lambda calling the auth Lambda is
rejected unless its origin is trusted. So the list unions two sources, both
declared by the consumer:

| source | gives |
|---|---|
| manifest edges | any construct depending on `auth` → the `API_URL` of the surface it lives on |
| workspace `uses` | web apps → their per-stage domains, plus localhost in dev |

Frontends must be listed explicitly, since they aren't constructs and no edge
exists to derive from — declared on the *app* (`uses: ['api', 'auth']`), keeping
the one direction the rest of the design uses: consumers declare, nothing
enumerates its own consumers. The same list feeds `RestApi` CORS, since it is the
same question asked twice.

**Cookies require one registrable domain.** `console.example.com` →
`api.example.com` is cross-origin but **same-site**, so a cookie with
`Domain=.example.com` and `SameSite=Lax` is sent on those requests. An app on a
*different* registrable domain cannot share the cookie at all and must use
**bearer tokens** instead.

**Supported today: apps under one base domain. Anything else uses bearer
tokens.** This is detectable at build — once origins are resolved, each is
compared against the stage's root domain, and an off-domain app fails with a
specific message rather than a mysterious 401 in the browser.

Two knock-ons: CORS **cannot** be `*`, because credentialed requests require an
explicit origin, which the derived list supplies; and mounting auth on the API
surface is the better default, since the cookie is then same-origin with the
calls that use it.

## The Manifest

A map keyed by id. **Anything that can be depended on is top level; anything
triggered by a surface nests inside it.**

```ts
{
  ordersDb:  { kind: 'database', provides: ['ORDERS_DB_URL', 'ORDERS_DB_READER_URL'] },
  uploads:   { kind: 'objects',  provides: ['UPLOADS_URL'] },
  sendEmail: { kind: 'function', provides: ['SEND_EMAIL_URL'], requires: [],
               handler: '…', dependencies: [] },

  api: { kind: 'rest-api', provides: ['API_URL'],
         authorizers: ['jwt', 'iam'],
         endpoints: [
           { id: 'createOrder', handler: '…', method: 'POST', path: '/orders',
             authorizer: 'jwt', requires: ['ORDERS_DB_URL'],
             dependencies: [{ target: 'ordersDb', kind: 'database' }] },
         ]},

  userEvents: { kind: 'topic', provides: ['USER_EVENTS_URL'],
                events: ['user.created', 'user.deleted'],
                subscribers: [
                  { id: 'sendWelcome', handler: '…', events: ['user.created'],
                    requires: ['SEND_EMAIL_URL'],
                    dependencies: [{ target: 'sendEmail', kind: 'function' }] },
                ]},

  processOrder: { kind: 'queue', provides: ['PROCESS_ORDER_URL'],
                  worker: { id: 'processOrderWorker', handler: '…', requires: […], dependencies: […] } },
}
```

**Position is the trigger**, so there is no `trigger` field — `createOrder`
sitting in `api.endpoints` *is* the statement that the API triggers it. One less
thing to state, one less reference to validate.

The rule for what nests follows from what's consumable: **nothing ever depends
on an endpoint, subscriber, or worker.** An endpoint's address is just its API's
URL plus a path, so `RestApi.service` is the typed caller and the endpoint has no
service of its own. Since they're never edge targets, they don't need top-level
identity — while resources, surfaces, and standalone functions do, because
`dependencies[].target` resolves as `m[target]`.

Each top-level entry therefore arrives at the adapter with everything needed to
construct it — no filtering, no index, no lookup.

**Every construct lands in the manifest, and the manifest is what resolves
dependencies** — not references captured between construct objects. Discovery
imports every module before anything resolves, so assembly has the complete set
and import order can't affect the result.

**`provides` and `requires` are directional and both explicit.** `provides` is
what a construct resolves onto its dependents; `requires` is what it needs. A
`function` is the one kind with both: it provides its invoke URL and requires
its own edges' keys.

| kind | provides | requires |
|---|---|---|
| `objects`, `database`, `cache`, `topic`, `queue` | its URL(s) | — |
| `rest-api` | `API_URL` + authorizer keys | — |
| `function` | `SEND_EMAIL_URL` | its edges' keys |
| `endpoint`, `subscriber`, `worker`, `cron` | — | its edges' keys |

Which makes the central claim an assertion rather than a convention:
**`requires` must equal the union of `provides` across `dependencies`**, plus
whatever `fromService` lifts sniffed.

**Defaults are resolved at build.** An endpoint that inherited its API's
authorizer records the concrete value, so no adapter re-implements inheritance.
Same principle as env: the manifest holds resolved facts, not rules.

**Back-compat.** The existing per-kind fields (`routes`, `crons`, …) are emitted
as derived projections for the deprecation window, so `@geekmidas/cloud/sst`
consumers compile unchanged.

### Validation at manifest build

- **Id collisions** on `environmentCase(id)` — subsumes casing and separator
  variants, and is the form that actually collides in the env. Across **all**
  constructs regardless of kind, plus lifted services: a `Topic` and a
  `Database` both named `orders` conflict on `ORDERS_URL` and `services.orders`.
  Scope is per app; cross-app is handled by the adapter's `prefixedName`.
- **Reference integrity** — every `dependencies[].target` resolves to a
  top-level entry in the map.
- **`requires` ⊆ ⋃ `provides`** across a construct's dependencies — the declared
  contract, enforced. This is what would have caught `function` omitting its own
  `provides`: a consumer would require a key nothing supplies.
- **Route uniqueness per API** on `${method} ${path}` within `api.endpoints`.
- **Authorizer names** — every endpoint's `authorizer` exists on its API.
- **Subscribed events** — every subscriber's events are declared by its topic.
- **Cycles** over function→function edges.
- **Dead declarations** — a topic no subscriber consumes, an API with no
  endpoints.

The same check runs in `gkm dev`, since discovery already re-runs on change. The
error message is the value: both source locations, the canonical form they
collided on, and which surfaces conflict.

### Discovery: one `constructs` glob

```ts
// before                        // after
{ routes: 'src/api/**/*.ts',     { constructs: 'src/**/*.ts' }
  crons: 'src/crons/**/*.ts', … }
```

A glob per kind is the same specialness the model removes — and **resources have
no kind to be listed under**, so a declared `ObjectStorage` would never be
discovered. `Generator` already imports each module and inspects every export, so
the per-kind `isConstruct` checks collapse into one structural test.
`PartitionedRoutes` retires with it: surfaces are the deploy slices, so `Routes`
becomes `string | string[]`.

**The dev watcher must be fixed in the same phase**, because a single glob makes
discovery *more* central, not less. Today `gkm dev` cannot discover anything new:

```ts
watcher.on('change', …)   // the only handler — no 'add', no 'unlink'
```

Two compounding gaps. There is no `add`/`unlink` handler, so a new construct
file never triggers a rebuild and a deleted one leaves stale routes. And
`dirsToWatch` is computed **once at startup** from directories that already
contain matching files, so a brand-new directory isn't watched at all — meaning
even adding the handler is insufficient without watching the glob's roots.

With `constructs: 'src/**/*.ts'` the fix is also simpler: watch the root, handle
`add`/`change`/`unlink`, and re-run discovery plus the validation pass on each
event. That gives new constructs, deleted constructs, and collision/reference
errors the moment they're introduced rather than at deploy.

## Target Adapters

Each kind maps to a component in `@geekmidas/cloud/sst`, which already wraps the
SST resource and implements `GkmLinkable`:

| kind | `@geekmidas/cloud/sst` | SST | `ResourceType` |
|---|---|---|---|
| `objects` | `Storage` | `sst.aws.Bucket` | `sst:aws:Bucket` |
| `database` | *(to add)* | `sst.aws.Postgres` | `sst:aws:Postgres` |
| `queue` | `Queue` | `sst.aws.Queue` | `sst:aws:Queue` |
| `topic` | `Topic` | `sst.aws.SnsTopic` | `sst:aws:SnsTopic` |
| `secret` | *(to add)* | `sst.sst.Secret` | `sst:sst:Secret` |
| `cache` | *(to add)* | — | — |

#### Linkables declare what they provide

Today the direction is backwards: `@geekmidas/envkit/sst` holds a resolver table
keyed by SST type (`Bucket` → `<NAME>_NAME`), and `LinkedEnvironment` runs it in
reverse — `getProvidersForEnvVars(names)` guesses which link supplies a sniffed
variable. With `provides` declared on the construct, the component states it:

**The contract between the app construct and the infra component is an
interface** — the shape of what's provided. Not shared implementation: a shared
codec would have to contain `bucket` and `region`, which are S3 words, and
smuggling those into the neutral layer is the same mistake as `queues` meaning
SQS. An interface stays neutral because it describes only the *number and role*
of the values, never their provider syntax.

```ts
// @geekmidas/manifest — type-only, no cloud vocabulary
export interface ProvidesByKind {
  objects:    { url: string };
  database:   { url: string; readerUrl: string };
  cache:      { url: string };
  queue:      { url: string };
  topic:      { url: string };
  'rest-api': { url: string };
}
export type Provides<K extends keyof ProvidesByKind> = ProvidesByKind[K];
```

```ts
// app — declares the names
class ObjectStorage implements Construct<'uploads', StorageClient> {
  declare() {
    return [{ kind: 'objects', id: this.id, provides: keysOf<Provides<'objects'>>(this.id) }];
    //                                                → ['UPLOADS_URL']
  }
}

// infra — supplies the values for the same keys
class ObjectStorage extends sst.aws.Bucket implements Supplies<'objects'> {
  provides(): Record<keyof Provides<'objects'>, $util.Input<string>> {
    return { url: $interpolate`s3://${this.name}?region=${this.region}` };
  }
}
```

Adding `readerUrl` to `database` then breaks whichever side hasn't implemented
it, in both packages, at build. And the env-name mapping falls out of the same
interface rather than being a second convention:
`environmentCase(`${id}_${key}`)` gives `url` → `UPLOADS_URL` and `readerUrl` →
`ORDERS_READER_URL`, so the reader/writer question becomes a one-line change to
`ProvidesByKind`.

How the infra composes the string and how the client parses it stay private to
each provider pair — `s3://` and `gs://` never enter the contract.

**Composition happens at infra time, from what the base linkable supplies** —
which is the mechanism already in `@geekmidas/envkit`:

```ts
// SstEnvironmentBuilder.ts — Postgres supplies { database, host, password, port, username }
const postgresResolver = (key: string, value: PostgresValue) => ({
  [`${key}Url`]: `postgresql://${encodeURIComponent(value.username)}:…@${value.host}:${value.port}/${value.database}`,
  …
});
```

The linked resource exposes its properties; the resolver composes the derived
value from them. So a construct's `provides()` is the same operation, moved onto
the component that owns the resource — which is what lets `Cache` (Upstash, not
an SST resource) and any `external()` resource participate without an entry in a
central table keyed by SST type.

You never hand-list env vars either way: linking a `Database` supplies its
config, and `Credentials` plays the same role in dev.

Values come from **the resource itself** — `this.name`, not a recomputed physical
name, because the name may be supplied through props or generated by SST and only
the resource knows which. Same for region: a bucket can live in a different
region than the function reading it, and `AWS_REGION` in a Lambda is the
*function's* region.

So one edge yields two things: `link` grants the IAM **and** carries the
properties; `provides()` composes them into the key the construct declared.

**The interface is the contract; the assertion is the enforcement.** The
app↔infra `provides` contract is the one place a runtime check earns its keep,
because it is the only guarantee that spans two packages, two build phases, and
two authors — and a JavaScript consumer gets no compiler help with it at all. So
the declared/composed pair is *also* checked at synth:

```ts
assertProvides(declaration.provides, Object.keys(component.provides()));
```

This is deliberately narrow. Guarantees that live inside a single package —
`.dependsOn()` rejecting a non-construct, a handler's inferred service types —
are left to the compiler; duplicating them at runtime is cost without a boundary
to defend.

**Most of this exists.** `Api.fromManifest`, `Function.fromManifest`, and
`Cron.fromManifest` already build SST resources from manifest entries;
`GkmLinkable` already carries `_id`/`_type`; `ResourceType` in envkit already
maps an SST type to the resolver producing a linked resource's env vars. The
chain is closed at every step but the first:

```
ObjectStorage('uploads')   app code declares
  → kind: 'objects'        manifest (neutral)
  → sst.aws.Bucket         adapter picks the component
  → _type: sst:aws:Bucket  linkable, _id = 'uploads'
  → UPLOADS_URL            adapter writes it from the bucket's outputs
  → connect(env) → client  the construct's own connect(), same key
```

Which is visible in today's API — functions come from the manifest, resources
don't:

```ts
Api.fromManifest(stack, 'Api', manifest.routes, { links: [db] });
//                             ^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^
//                             derived           hand-written
```

After: `Stack.fromManifest(stack, manifest)` provisions every kind, and each
route's links, env, and IAM derive from its own `dependencies`.

### Filtering: each function gets its dependencies and nothing more

A function is linked to exactly the constructs it declared, never the app's full
set. This is already the design intent of `LinkedEnvironment` — documented as
"least-privilege linking" — and `Api` already applies it per route via
`resolveLink(route.environment)`.

What changes is what the filter is computed from. Today it runs backwards:
sniff the route's services → env var names → ask each link's resolver which
names it provides → keep the intersection. With edges it's a direct lookup:

```ts
const link = route.dependencies.map((d) => provisioned[d.target]);
```

Three things improve. The candidate pool stops being hand-maintained. **Under-
reporting stops being silent** — because the filter keys off *sniffed* names, the
`catch → []` path doesn't just lose env vars, it makes `resolveLink` return
*fewer links*, so the route deploys without the resource and fails at runtime
with a permissions error. And `EnvValidationError` guards a narrower gap: it
exists because required vars and available links are independently maintained,
and one edge collapses that class of error.

## Boundaries

### A resource belongs to exactly one app

There is no cross-app resource reference. If app B needs app A's data, it goes
through **A's API** — not A's bucket, not A's database.

Sharing would mean the dependency edge crosses a deploy boundary (so neither
manifest is self-contained and deploy order starts mattering), schema ownership
becomes ambient, and derived IAM has to reach across app boundaries. An API
boundary makes the coupling explicit, versionable, and typed — and this repo
already generates typed clients for it. The invariant that matters: **every edge
in an app's manifest points at a construct that app owns.**

### Packaging

**In `@geekmidas/constructs`, behind one subpath per construct.** A second
segment appears only when the choice **changes the code you write**:

```
@geekmidas/constructs/object-storage       ← one import; S3 vs GCS changes no handler code
@geekmidas/constructs/database/kysely      ← the query builder is visible in every query
@geekmidas/constructs/database/knex
```

Never group by role (`resources/`) — resource and function are roles, not a
partition, and `Queue` is both. And **no barrels at any level**, including
`@geekmidas/constructs/database`, which would pull in both drivers and undo the
gating.

The gating mechanism already exists: optional peer dependencies plus subpath
exports. Clients never depend on
the framework; `constructs` consumes them.

Three rules keep problem 5 fixed, and a fixture package that installs **only**
`@geekmidas/constructs` and then type-checks and imports the root enforces them:
the root export has **zero runtime imports**, optional peers are `import type`
only, and nothing re-exports across a gate.

### Refs, and what they're for

`.dependsOn([sendEmail])` is a value import, and tree-shaking is module-granular
— so importing the module that defines a *function* pulls its handler and full
transitive tree into the caller's bundle.

```ts
import type { sendEmail } from './send-email';        // erased
.dependsOn([Construct.ref<typeof sendEmail>('sendEmail')])
```

`Construct.ref(sendEmail)` taking the value cannot work: the value import *is*
the coupling. Value imports stay fine for handler-less constructs — resources
and topics are schemas and config.

| target | direct import | why |
|---|---|---|
| `server` | fine, preferable | one process, one bundle; the call is in-process |
| `aws` | use `ref` | separate bundles; a direct import doubles the caller's Lambda |

A generated `.gkm/refs.ts` (type-only imports throughout) removes the duplicated
id string and makes the safe form the convenient one.

### Later: pieces from different providers

| Decision | Decided by | When |
|---|---|---|
| *I need object storage called `uploads`* | app code | authoring |
| which adapter provisions it | `--target` (+ per-resource override, later) | deploy |
| the connection URL | the adapter, on provision | deploy |
| which client driver runs | the build, per target | build |

Per-resource targeting is a config change, not a redesign — the manifest says
nothing about who provisions, so adapter selection is a lookup that can take a
`targets.overrides` entry in the **deploy layer**. Putting `{ provider: 'gcp' }`
on the construct would bake a deployment fact into portable code.

The commoner case is a resource you never provisioned — Neon, Upstash, R2. That
needs no multi-target machinery: `Database.external('orders')` declares the
dependency, skips provisioning, and takes its URL from secrets.

**The limitation:** least privilege by construction works because an adapter can
turn an edge into IAM *within* one cloud. A Lambda reaching a GCS bucket has no
such mechanism — that edge degrades to an injected credential rather than a
derived role.

## Alternatives Considered

**A. Constructs replace `Service` entirely.** Cleaner end state, one mechanism.
**Rejected** — breaks every app for a mostly aesthetic gain. The additive path
reaches the same place and leaves this open.

**B. Add resources to the manifest but keep sniffing.** Fixes problems 1, 3, 4
cheaply. **Rejected as an endpoint**, adopted as an intermediate state: Phases
0–4 land there and Phase 5 finishes.

**C. Generate constructs from workspace config.** **Rejected** — config isn't
typed against app code, so the rename problem returns, and it inverts the stated
direction.

**D. Ship each construct from its client package** (`@geekmidas/storage/construct`).
**Rejected** — inverts the layering rule, creates a `storage → constructs →
storage` cycle, and forces splitting out a construct-core package.

**E. Nest children under their surface in the manifest.** **Rejected** — see
[The Manifest](#the-manifest).

**F. A separate `WebhookApi`.** **Rejected** — a signature check is an
authorizer, and modelling it that way removes the raw-body problem too.

## Implementation Plan

**Phase 0 — manifest contract.** `Declaration` union, the id-keyed map, derived
legacy projections, and the validation pass (collisions, reference integrity,
route uniqueness, cycles). *Touches:* `packages/manifest`, `packages/cli`.

**Phase 1 — the construct interface, and conform the existing constructs.**
`Construct<TName, TClient>`, `.dependsOn()`, `Construct.fromService()`,
`.name()` on every builder, immutable builders, `.service` as a field, the
sniffer moved out of the base, the single `constructs` glob. `Endpoint` is the
proof — if the interface can't express it, stop here. *Touches:*
`packages/constructs`, `packages/cli`.

**Phase 2 — first vertical slice: `ObjectStorage`.** `declare()` → manifest →
derived `Service` → `Stack.fromManifest` provisions and derives the link and IAM
from the edge → `gkm docker` emits MinIO → build-time driver pinning. **This is
the phase that validates or kills the design.**

**Phase 3 — `KyselyDatabase`.** Its own slice, not a third of one: the ALS
connection resolver, the bound-method proxy, `$pool`, and `.database()`
retargeted. Acceptance: `new KyselyDatabase<OrdersDB>('orders')` alone types `db`
in handler and session extractor, with the hand-threaded builder type parameters
gone.

**Phase 4 — surfaces.** `RestApi` with authorizers, `Topic`/`Queue` retrofitted
onto the interface (constructor-assigned `service`, no default logger, publisher
naming), `e` as a default `RestApi`, `s` deprecated.

**Phase 5 — `Cache`, `Secret`, and declaration-first env.** Sniffing narrows to
`fromService` lifts and the deprecated `.services()`.

**Phase 6 — retire the third declaration.** Derive docker-compose from the
manifest and deprecate the workspace `services:` block.

**Follow-ups:** `KnexDatabase` (needs `@geekmidas/db/knex` first), generated
`.gkm/refs.ts`, per-resource targeting.

## Testing Strategy

- **Golden manifest tests.** A fixture app with one of each kind, asserted
  against a checked-in snapshot — contract drift caught in the one place three
  consumers read from.
- **Round-trip config keys.** For every built-in construct, `declare()` keys and
  `connect()` keys must be identical. This is the drift guard, enforced.
- **Filtering, as exclusion.** Three constructs declared, a route depending on
  one: assert its links contain exactly that one, and that adding an unrelated
  construct leaves every existing route's link set byte-identical.
- **Transaction scoping, interleaved.** Two concurrent requests must see their
  own transactions through the same captured `services.orders`; a throwing
  handler rolls back; nested `withTransaction` reuses; `$pool` writes survive.
- **Logger staleness, interleaved.** A singleton client capturing the logger at
  `register()` must produce entries with distinct request ids.
- **Validation tests.** Each rejection — id collision, dangling reference,
  duplicate route, cycle — with an assertion on the message, since the message
  is the feature.
- **Type tests.** `services.<id>` inference; a plain `Service` in `.dependsOn()`
  fails to compile; `.database(new KyselyDatabase<OrdersDB>('orders'))` types
  `db` in handler *and* session extractor, with an unknown table failing to
  compile — that's what proves the schema flowed rather than degrading to `any`.
- **Package isolation.** A fixture installing only `@geekmidas/constructs`,
  type-checking and importing the root.
- **Sniffer regression.** The existing `getEnvironment` suite passes unchanged
  through Phase 5 — proof this stayed additive.

## Impact Analysis

| Package | Impact | Notes |
|---|---|---|
| `manifest` | Contract change | New `Declaration` union and id-keyed map; legacy fields derived |
| `constructs` | **Core** | Interface, `.dependsOn()`, surfaces, request-scoped clients; base loses 7 of 9 type parameters |
| `cli` | Moderate | Single glob, validation pass, `Stack.fromManifest` inputs, driver pinning, compose derivation |
| `cloud` | Moderate | Provisions by kind; links/env/IAM per function from edges; adds `Database`/`Cache`/`Secret` components |
| `envkit` | Minor | `ResourceType` ↔ kind mapping; resolvers already exist |
| `db` | Additive | `./knex` module for the `KnexDatabase` follow-up |
| `storage`, `cache`, `events` | None | Consumed *by* constructs; stay standalone |
| `services` | None | `Service` unchanged and still public |
| `client` | **Bug fix** | `iam` strategy is a silent no-op; needs the header/signing phase split |
| `testkit` | Simplification | Four bespoke test adaptors collapse toward one that swaps transport, not interface |

**Layering rule:** the client packages depend on **nothing** from `constructs`.
`constructs` consumes them, never the reverse.

## Open Questions

1. **Where does `Secret` sit?** It overlaps `gkm secrets:*` and `Credentials`,
   which already provision and inject. A `Secret` construct likely declares
   *which* secrets a function needs rather than provisioning storage — making it
   the odd kind out. Settle in Phase 5.
2. **Does the bundling story hold?** `ref` is designed to keep a callee's handler
   out of the caller's bundle, but it needs a real bundle-size measurement in
   Phase 2. If it doesn't hold, function→function edges must require the thin
   reference rather than accepting it as an option.
3. **When does per-resource targeting land?** The door is open (a
   `targets.overrides` lookup, no manifest change) and should stay closed until
   something forces it — every adapter then has to answer "what if my dependency
   lives elsewhere", and the answer at provider boundaries is *inject a
   credential*, not *derive a role*.

4. **Reader/writer credentials for `Database`.** A Postgres cluster has two
   endpoints, so `Database` provides **more than one value** — refining the
   single-`<NAME>_URL` rule to "one per address the construct owns"
   (`ORDERS_URL` writer, `ORDERS_READER_URL` reader). Three things to settle
   before Phase 3 hardens:

   - **Routing must be explicit, not inferred.** Kysely can tell a `selectFrom`
     from an `insertInto`, so automatic routing looks easy — and is unsafe:
     replica lag means a read issued just after a write returns stale data, and
     the failure is invisible at the call site. Default `services.orders` to the
     writer and require opting in to the replica.
   - **Inside a transaction, everything is the writer.** Read-your-writes makes
     any reader routing incorrect once a transaction is open, which the ALS
     resolver can enforce structurally: if a connection is in the store, use it,
     full stop.
   - **The edge could carry intent.** `read` vs `write` is a *declaration*, not
     a permission, so it fits the model — the adapter maps it to both the
     endpoint the client gets and the IAM it grants, letting a read-only
     function be provably read-only. That's a real least-privilege gain, but it
     is the first edge attribute beyond `target`/`kind`, so it deserves its own
     decision rather than arriving with the Database work.
