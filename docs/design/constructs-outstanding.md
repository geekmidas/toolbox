# Constructs Paradigm: What Is Outstanding

A companion to [Constructs Paradigm](./constructs-paradigm.md). That document
argues the design; this one records what is **not built**, and for each item
whether it is blocked on a *decision* or on *work*.

The distinction is the point. A list that mixes the two reads as a backlog and
gets worked top-down, which is how a decision nobody made gets made by whoever
picks up the ticket. Everything under "blocked on a decision" needs an answer
before code, and the answer is not obvious from the codebase.

**Status at the time of writing:** the construct half of the model is largely
complete — twelve declaration kinds, and a construct for each one that needs it.
The target adapters are not. The local target reconciles all twelve; the AWS
target provisions six.

---

## 1. The AWS target — six of twelve kinds

`PROVISIONERS` in `packages/cloud/src/sst/fromManifest.ts` is the whole gap.
Provisioned: `objects`, `file-server`, `site`, `queue`, `topic`, `secret`.

Nothing in this section has been deployed. The components are verified by their
decisions being pure functions — `provisionerFor`, `assertProvides`,
`siteEnvironment`, `isServed` are all assertable without Pulumi — and by parsing
each composed URL back with the client's own codec. A stack has never come up.

### 1.1 `database`, `database-reader`, `database-schema` — *decision*

Two decisions, and neither is a detail.

**Open Question 4 in the design doc is still open.** `orders.reader()` declares
a dependency on a reader endpoint without saying whether the adapter *creates* a
replica or *points at* one — and on `--target=server` there may be no replica at
all, in which case the reader URL should resolve to the writer rather than fail.
Everything else about readers is settled.

**RDS instance versus Aurora Serverless v2 is unchosen.** This is a billing
model, not a component swap: a fixed monthly floor against scale-to-zero. It
belongs to whoever pays the bill, not to whoever writes the provisioner.

`database-schema` provisions no AWS resource at all — it is DDL inside the
parent, and its component only re-composes the parent's URL with a
`search_path`. It follows whatever `database` becomes and needs no decision of
its own.

**First step once decided:** `sst.aws.Postgres` (or `sst.aws.Aurora`) wrapped as
a `Provisioned`, composing its URL with `postgresUrl.build` from
`@geekmidas/db/pg/url` — the codec already exists, and `@geekmidas/cloud` would
take `@geekmidas/db` as an optional peer the way it already takes `storage` and
`events`.

### 1.2 `cache` — *decision*

There is no AWS answer that keeps the client identical.

The local target runs `serverless-redis-http` in front of Redis *precisely so*
that dev and prod speak the same protocol — the client is Upstash's HTTP API in
both. ElastiCache does not speak it. So provisioning a cache on AWS means either

- an **Upstash provider dependency** and its credentials in the deploy path, or
- **ElastiCache and a second client**, which gives up the property the local
  proxy exists to preserve, or
- **leaving `cache` unprovisioned on AWS**, treating the cache as externally
  managed and injected as a URL — which is honest and is what many teams do.

### 1.3 `email` — *decision, then real work*

The declaration promises an `smtp://` URL, because that is what is true of email
whoever delivers it. SES has an SMTP interface, so the shape holds — but its
SMTP password is a *signed derivation* of an IAM secret access key, not a value
the API hands back. So the provisioner is an SES identity, an IAM user, an
access key, and a derivation, rather than one component.

The decision underneath it: whether `--target=aws` should provision that chain
at all, or whether a sending identity is stage config that arrives as a URL like
any other credential.

### 1.4 `rest-api` — *blocked on §2*

`packages/cloud/src/sst/aws/Api.ts` already exists and is not wired in, because
the surface node declares `endpoints: []` for an application's own API. Routes
still reach the deploy target through the separate `RouteInfo[]` pipeline. This
unblocks itself when the endpoint merge lands.

---

## 2. The endpoints → manifest merge — *work*

`RestApi` names a `routes` glob and declares `endpoints: []`; the build never
fills it. This is a debt introduced deliberately — the construct cannot import
route modules to answer "what paths exist" without evaluating the whole runtime
graph — but it is a seam, not a resting place. Three things stay broken while it
is open:

- **A surface cannot drive route generation.** Two pipelines describe the same
  routes: the manifest's `rest-api` node, and `EndpointGenerator`'s `RouteInfo[]`.
- **Per-route IAM cannot be derived from the graph.** `resolveEdges` gives a
  function exactly its own dependencies, which is what makes least privilege fall
  out of the edges — and an endpoint's edges are not in the manifest.
- **An endpoint's `.dependsOn()` is invisible to reverse lookups.** So an API's
  origin appears on an auth server's trusted list only because the *surface*
  declares that edge explicitly, not because its routes do.

**The obstacle is real and worth stating.** `EndpointFactory.dependsOn()`
immediately collapses into `.services()`, so the construct identity is gone by
the time an endpoint exists — only the `Service` objects survive. Recovering ids
means threading the constructs through every copy-on-write branch of the factory
(a dozen call sites), or registering endpoints onto their surface at build time.

---

## 3. `Credential` — *decided this session, unbuilt*

Open Question 1 ("where does `Secret` sit?") is answered: **it becomes
`Credential`, and it accepts a StandardSchema.**

```ts
export const stripe = new Credential('Stripe', {
  schema: z.object({ secretKey: z.string(), webhookSecret: z.string() }),
});

// in a handler — no await, already parsed and validated
services.stripe.secretKey
```

**The async question is already answered by an existing seam.**
`Service.register()` returns `TInstance | Promise<TInstance>`, and
`ServiceDiscovery.register()` awaits every one before a handler runs
(`packages/services/src/ServiceDiscovery.ts:123`). So a fetch and a validation
both happen in `connect()`, and application code never sees a promise —
including when StandardSchema's `~standard.validate` returns one itself.

**Where the value comes from follows the rule the design already has:** the
protocol picks the resolver, exactly as `<NAME>_URL` picks a driver.

```
STRIPE_CREDENTIAL = json:{"secretKey":"sk_…"}       # inlined — local, gkm secrets
STRIPE_CREDENTIAL = ssm:///myapp/prod/stripe        # fetched at register
STRIPE_CREDENTIAL = secretsmanager://arn:aws:…      # fetched at register
```

One key holding a JSON blob, which is also the shape Secrets Manager stores.
**Rejected:** deriving flat keys (`STRIPE_SECRET_KEY`) from the schema, because
StandardSchema v1 has no introspection API — enumerating a schema's keys means
reaching for `.shape` and being Zod-only.

Two things to settle while building it:

- **Memoisation.** The resolved value should be cached per process, or it is a
  network call per request — which means a rotated secret needs a restart. A TTL
  is the escape hatch if that bites; it should not be the default.
- **It is the first construct whose client is plain data** rather than a
  connection. That seems fine and is worth stating rather than discovering.

Open: whether the `secret` kind survives alongside `credential`, or whether a
signing key is just a `Credential` with a one-field schema.

---

## 4. The file server

### 4.1 Signing — *decided: not now*

`signedCookie` is not implemented, and `signedUrl` is an **S3 presign at the
bucket**, not a CloudFront signature. Both mechanisms remain in the design and
both need a key group and a private key — key material nothing declares yet, and
with no local equivalent to test against. What ships is the mechanism that works
identically in both places.

The consequence is a real difference in hostname: open paths are served from the
distribution, a signed read comes from the bucket's own host. It is documented in
the construct's docblocks rather than smoothed over, because a presign and a
CloudFront signature share only the word "signed".

### 4.2 The local CDN-shaped host — *work*

`UPLOADS_SERVER_URL` resolves to MinIO's **path-style** address, which works and
is not the deployed shape. MinIO's virtual-host mode reads the leading label *as
the bucket name*, so it only produces the CDN shape when the server's id and the
bucket's agree — and never for a server fronting two buckets.

The honest fix is a small proxy in front of MinIO mapping host and path patterns
onto buckets the way a distribution does. It is additive, changes no construct
API, and is the only component that could also verify a signature locally. **An
AWS emulator does not supply it:** CloudFront emulation in LocalStack and in
floci is control plane only — distributions, origins, behaviours, invalidations
— which provisions a distribution that never serves a byte.

### 4.3 `--target=server` — *decided, unbuilt*

**Decision: MinIO, the same way local works.** The server target grows a MinIO
container and the file server resolves path-style with the same bucket policy.
Cheap, because the reconcile pipeline *is* the mechanism. The proxy in §4.2
serves both targets when it lands.

### 4.4 A known asymmetry — *documented, no action*

A single `*` is **stricter in the client than in the S3 policy**. The construct's
runtime check stops at a segment boundary, matching a CDN behaviour; an S3 policy
resource's `*` crosses `/`. So `avatars/*.png` admits `avatars/2024/me.png` in
the policy and is refused by the client. The client is the stricter of the two,
so nothing it refuses was ever relied on the policy to refuse — but a key fetched
directly, bypassing the client, can be admitted. Prefer `**` where crossing
segments is what you meant.

---

## 5. `StaticSite` is not exercised — *work*

`StaticSite` is covered by tests and by nothing running. kitchen-sink has no
frontend app, so the site → API edge, `VITE_` injection, CORS and the cookie
domain are all asserted and never observed.

Adding a minimal Vite app to kitchen-sink is the smallest thing that makes all
four real at once, and it would also exercise `surfaceAddresses` matching a site
declaration to a workspace app by `path`.

Also unbuilt: only the `static` variant has a delivery path. `next` and
`tanstack` exist in `PUBLIC_PREFIX` and have no provisioner. Expo is out of
scope by design — an app store is not infrastructure.

---

## 6. Auth

### 6.1 Capability vocabulary — *documented deviation*

kitchen-sink imports `magicLink` from `better-auth/plugins` and passes it to the
construct, which is the provider leaking into application code that
["The client is generated, and the server dictates capabilities"](./constructs-paradigm.md)
exists to prevent. It should be `capabilities: { magicLink: { send } }`, with the
send callback still reaching the mail construct as it does now.

### 6.2 Generated clients — *work, with one measured constraint*

`gkm dev` should generate the auth client bound to `AUTH_URL` and the API clients
bound to `API_URL`. OpenAPI generation already exists.

**You cannot infer which client plugin pairs with which server plugin.** Measured
against the installed better-auth:

```
server plugin ids:  magic-link,  open-api,  admin
client plugin ids:  magic-link,             admin-client
```

`magicLink()`/`magicLinkClient()` agree on `magic-link`; `admin()` is `admin`
while `adminClient()` is `admin-client`. Joining on id would silently emit a
client missing every admin method, with no error anywhere. Naming convention does
not save it either — `email-otp` maps to `emailOTPClient`, not `emailOtpClient`.

So, in order of preference:

1. **Capabilities** (§6.1) — we own both ends of the table by construction, and
   it is the only mechanism that survives swapping to Auth0.
2. **A curated `serverId → { module, export }` table** for raw plugins, verified
   at generation time by importing the client module and checking the export
   exists, so a version bump fails loudly instead of emitting a broken client.
   Anything with no entry gets a warning naming what was omitted.
3. **Base URL only** — `createAuthClient({ baseURL: AUTH_URL })`, letting the app
   add its own plugins. Even this removes the hand-maintained URL.

The thing to avoid is inferring from the plugin objects: it reads as clever, it
works for the plugin you test with, and it fails by omission rather than by
error.

---

## 7. Correctness and infrastructure gaps

### 7.1 `provisionOrder` orders `of`, not `dependencies` — *work*

`fromManifest` provisions sites **last, in a separate pass**, because a static
site needs its edges' values at construction time and `provisionOrder` only
orders derivation. That is sound while a site is a pure consumer of addresses and
produces none. The first kind that needs another construct's value at
construction time turns the second pass into a real topological sort.

**There is no cycle check over `dependencies` at all.** `assertDerivations`
proves `of` chains are acyclic by construction (a reader is terminal), which says
nothing about edges. A topological sort would need one.

### 7.2 Spec files are excluded from the project typecheck — *work*

`tsconfig.base.json` excludes `**/*.spec.ts`, so `tsc --build` never type-checks a
test. This is not theoretical: a `BucketClient` stub in
`reconcile.spec.ts` was missing two required methods and nothing reported it —
found only by running `tsc` against the file directly.

Vitest transpiles without checking, so these errors surface nowhere. Either
include specs in a check, or add a separate `tsconfig.test.json` to the pipeline.

### 7.3 Two spellings of `search_path` — *work, small*

The local target writes `postgres://…?search_path=authdb`
(`packages/cli/src/reconcile/env.ts`), and `@geekmidas/db/pg/url` writes the
libpq-correct `?options=-c search_path=…`. Both work — `KyselyDatabase`'s `pool()`
translates the first, and `pg` understands the second natively — but they are two
spellings of one fact.

The fix is for the local target to build through the codec, which means
`@geekmidas/cli` taking a dependency on `@geekmidas/db` — a real layering
decision for one function, which is why it was not done in passing.

### 7.4 Test suites that need containers — *environment*

`@geekmidas/events` had **no vitest config**, so its specs were never discovered
by the root `projects: ['packages/*']`. Adding one runs 114 tests, of which the
RabbitMQ and pg-boss ones need brokers. The same is true of the Postgres-bound
integration specs in `constructs` and the LocalStack-bound `deploy` specs in
`cli`.

None of this is new breakage — it is previously invisible breakage now visible,
plus a documented port conflict with another project on 5432/4566/8079.

### 7.5 Dev-server resilience — *parked, documented*

See [dev-server-resilience-design](../../packages/cli/docs/dev-server-resilience-design.md).
The supervisor, the tsx PID registry, and worker-thread hot reload are designed
and unbuilt; the Zod duplicate-id error on HMR is subsumed by the last of those
and is worked around today by clearing the registry in `discover` and the
generators.

---

## 8. What has not been verified

Stated plainly, because "tests pass" and "it works" are different claims.

- **Nothing has been deployed.** No AWS credentials in this environment; the AWS
  target's six provisioners are verified as pure decisions, not as a stack.
- **The file server has not run against MinIO.** Docker was not up. The bucket
  policy is asserted as a document, not as an applied policy.
- **kitchen-sink has not been re-run end to end** since the API, file server and
  auth surface changes. It was verified end to end from an empty volume in an
  earlier session — magic-link sign-in through Mailpit, presigned MinIO upload,
  pg-boss fan-out, cache in Redis — but not since.

---

## Suggested order

Not a plan, a suggestion — the decisions in §1 and §3 belong to whoever owns the
bill and the security model, and the rest follows them.

1. **§3 `Credential`** — decided, self-contained, and closes an open question.
2. **§5 kitchen-sink frontend** — makes four already-built derivations observable
   rather than merely tested, and is cheap.
3. **§2 the endpoint merge** — unblocks `rest-api` on AWS and per-route IAM, and
   is the largest piece of correctness debt in the model.
4. **§1.1 `database`** — once the replica and RDS/Aurora questions are answered.
   Nothing meaningful deploys without it.
5. **§7.2 and §7.3** — small, and §7.2 is the kind of gap that hides others.
