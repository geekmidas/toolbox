# Constructs Paradigm: What Is Outstanding

A companion to [Constructs Paradigm](./constructs-paradigm.md). That document
argues the design; this one records what is **not built**, and for each item
whether it is blocked on a *decision* or on *work*.

The distinction is the point. A list that mixes the two reads as a backlog and
gets worked top-down, which is how a decision nobody made gets made by whoever
picks up the ticket. Everything under "blocked on a decision" needs an answer
before code, and the answer is not obvious from the codebase.

**Status, re-verified against the code (2026-09-02):** the construct half of the
model is complete. The declaration union has **fifteen** members, thirteen of
which a target provisions — `function` and `cron` carry a handler and reach a
target through the function pipeline instead. Every one of the thirteen has a
construct, and the local target reconciles all of them.

The AWS target now has a provisioner for all thirteen too, which is a change
from the last writing and a smaller one than it sounds: `rest-api` provisions
the surface and nothing on it. See §1.4.

Where a claim below was checked rather than remembered, it says so.

---

## 1. The AWS target — thirteen provisioners, one of them empty

`PROVISIONERS` in `packages/cloud/src/sst/fromManifest.ts` covers every
provisionable kind. What is left is not a missing entry but a hollow one:
`rest-api` provisions an API with no routes on it, and that is blocked on §2
rather than on a decision.

Nothing in this section has been deployed. The components are verified by their
decisions being pure functions — `provisionerFor`, `assertProvides`,
`siteEnvironment`, `isServed`, `bootstrapEvent` are all assertable without
Pulumi — and by parsing each composed URL back with the client's own codec. A
stack has never come up.

### 1.1 `database`, `database-reader`, `database-schema` — **done**

Both decisions answered themselves once SST's own components were read.

**An RDS instance, not an Aurora Serverless v2 cluster.** This was first
answered the other way, on the stage model: provisioning per stage makes stages
cheap and encourages having several, a provisioned instance puts a fixed monthly
floor under every one, and Aurora defaults to `min: 0 ACU`. That reasoning still
holds for a fleet of idle preview stages. It lost to a plainer one — a cluster
is more moving parts and less predictable pricing for the steady-state workload
most stages actually are, and the ordinary thing is the better default. Aurora
is not reachable through overrides: the component's props *are* the RDS
component's args, so wanting a cluster means a second class rather than a
setting. Moving between them replaces the database.

**Nobody provisions the read replica** (Open Question 4). An RDS instance has
one endpoint, so a reader resolves to the writer's address. That is safe because
read-only is enforced by the reader role's grants, not by which endpoint was
reached — the same reason the fallback was already specified for
`--target=server`. `urlFor({ reader })` keeps the option so intent stays at the
call sites, and a stage that later runs a cluster changes one line rather than
all of them.

**The engine version is declared** rather than set per target. It was set in two
unrelated places — a container tag locally, nothing at all on AWS, so the engine
chose — and had drifted a major apart, local on 18 and Aurora on 17.7, with
nothing recording it. `version` on the declaration is read by both: the
container tag locally, the engine version deployed. It is a union of majors
rather than a string, because a typo is a confusing image pull locally and a
deploy that fails partway through on AWS, and both are better as a compile
error.

**The roles are created by a Lambda**, because SST provisions a cluster and
nothing in Pulumi runs SQL. `DatabaseBootstrap` generates the passwords and a
function inside the VPC applies `roleStatements` as the cluster master — the
only credential that exists before any role does.

**One secret for the cluster, holding every role.** The worry that a shared
secret lets anything holding it become any role describes a read that does not
happen: no function fetches a credential, because each node publishes only its
own URL through its own link, so a handler is *given* its role and has no IAM to
read Secrets Manager at all. What the secret is for is out-of-band use — a
person with break-glass, an external tool, a rotation job — and that is where
the case for splitting it lives: per-tenant secrets are what let IAM grant
somebody one role's password without the others. Nothing needs that yet.

Worth knowing: the secret **records** the generated passwords rather than being
the source of truth. Making it authoritative — read at deploy, so rotating it
propagates on the next one — is a better rotation story and a different design,
needing a first-deploy seed and a DDL re-run to make a changed value real.

Still open here: **nothing has been deployed**, so the bootstrap is unverified
end to end (see §8). And roles are cluster-scoped in Postgres, so two stages
sharing one cluster would collide — every stage currently gets its own.

### 1.2 `cache` — **done**

`services.cache: 'upstash' | 'elasticache' | 'db'`, defaulting to Upstash. The
same application code caches into any of them, which is why it is config beside
`services.events` rather than a field on the construct.

Cache backends genuinely differ — Upstash speaks HTTP, Redis its wire protocol,
a table SQL — so unlike email the client *does* change, and the scheme picks the
driver exactly as it does for object storage. The driver modules are the lazy
boundary: an app caching in Postgres never resolves `ioredis`, one caching in
Upstash resolves neither it nor `pg`, and the generated entry registers precisely
one, keyed off the backend.

Each backend is consistent between local and deployed, which is the property
worth having: `upstash` runs the HTTP proxy locally, `elasticache` runs plain
Redis, and `db` runs nothing at all.

Deployed, only `elasticache` provisions anything — a *serverless* Valkey cache,
because this design provisions per stage and a node sized for an idle preview
stage still costs what a node costs. `db` resolves the declared
database's URL; `upstash` is an account rather than infrastructure, so its URL is
an input and `CacheNeedsUrl` says so rather than defaulting.

One interaction worth remembering: the Postgres cache does **not** create its
table lazily. A handler's role may not create anything, so the DDL is exported
and applied by whatever applies DDL — the same split `roles.ts` uses.

### 1.3 `email` — **done**

`services.mail: 'ses' | 'resend' | 'smtp'`, defaulting to SES, and it changes
almost nothing — which is the declaration being right. Every backend speaks SMTP,
so the `smtp://` URL is true of all of them and the client never changes. Only
who issues the credential differs.

`resend` and `smtp` compose a URL from a value you hold, and `EmailNeedsUrl`
says so when you have not: they are accounts somebody created, so there is
nothing for a deploy to provision. `ses` is the only backend that *can* mint its
own — an identity, a user, an access key, and a password derived from that key —
and it does so only when handed no URL. Credentials that already exist are the
common case, and creating a second IAM user for an identity that already sends
would be a deploy quietly adding another way into the account.

**How far the derivation is verified, stated because it matters.** The recipe
was taken from AWS's own page and matches step for step. AWS publishes no worked
example, so there is no golden value to assert against; the tests check the
properties the recipe implies — the version byte survives, it is deterministic,
it changes with key and with region. A wrong password fails at the first send,
long after the stack reported success. The same page also gave a guard worth
having: not every region has an SMTP endpoint, and deriving for one that does not
produces a credential that can never work.

### 1.4 `rest-api` — *provisioned, empty; blocked on §2*

`RestApiSurface` is wired in and provisions the surface. It is deliberately not
`Api` — that component takes a route table and validates each route's
environment at synth, and it needs routes; the manifest's `rest-api` node still
declares `endpoints: []` for an application's own API.

So an API Gateway comes up that 404s everything, and it is still worth
provisioning, because what everything downstream needs is the **address**: a
site inlines it as `VITE_API_URL`, an auth server puts it on its trusted-origin
list, and the cookie domain derives from it. Those are blocked on the API
existing, not on it answering.

Routes still reach the target through the separate `RouteInfo[]` pipeline —
`Api.fromManifest(stack, 'Api', manifest.routes)` — which is the concrete shape
of §2's "two pipelines describe the same routes". The two components collapse
into one when the endpoint merge lands.

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

## 3. `Credential` — **done**

Open Question 1 is closed. `Credential` sits *beside* `Secret` rather than
replacing it, because the two differ by lifecycle and that is the only
difference worth two kinds for: a secret is generated and rotated by the
platform and is one opaque string; a credential is issued by someone else,
arrives with several fields, and is validated on the way in.

```ts
export const stripe = new Credential('Stripe', {
  schema: z.object({ secretKey: z.string(), webhookSecret: z.string() }),
});

services.stripe.secretKey   // no await — already parsed and validated
```

The async question needed no new machinery: `ServiceDiscovery` already awaits
every `register()` before a handler runs, so the fetch and the validation both
happen in that seam. One key holding JSON, because that is what a secret manager
stores and the only shape an arbitrary StandardSchema supports — the spec has no
introspection API. Resolved once per process, holding the *promise* so
concurrent registrations share one resolution; `refresh: true` for a credential
that rotates faster than a restart.

**Still open:** only the value-inline path exists. `ssm://` and
`secretsmanager://` resolution at registration is designed and unbuilt — and
largely unnecessary on SST, which injects the value through the link.

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

### 6.1b Provider naming and swapping — **decided, revisit later**

Asked and settled: no `new Auth({ provider: 'better-auth' })`, no facade over
the auth *server*, and no rename of `BetterAuth`.

**Why not a `provider` field.** It is the shape the design rejects elsewhere —
the email declaration says so outright — and auth does not even qualify for that
treatment. A cache or a mailer genuinely varies by stage: the same code caches
into any backend. Auth does not. You cannot run better-auth in dev and Auth0 in
prod, because the user tables, the session format and the tokens all differ. It
is structural, so it lives in code.

**Why siblings.** The precedent is the database, not the cache: `KyselyDatabase`
today and `KnexDatabase` planned, two constructs sharing one kind. Auth is the
same — `BetterAuth` and `OidcAuth`, both with id `Auth`, which is why the class
name keeps the library in it. Renaming one to `Auth` would leave a pair where the
neutral-sounding name secretly means better-auth.

**Why not a facade over the server.** Beyond the doc's argument that it lands
leaky or anemic: the barrier to swapping providers is *data*, not API. Migrating
users, re-inviting passwords and invalidating every live session is the cost, and
no abstraction touches it. A facade would promise a portability it cannot
deliver, while adding two security-critical implementations to keep correct.

**What is abstracted instead** is the authorizer — `verify(request) → Session |
null` — which is the one thing every endpoint consumes and the one thing both
kinds of provider genuinely share. Most of it exists: `@geekmidas/auth` ships
`OidcVerifier` with hono and lambda adaptors, so `OidcAuth` wraps code rather
than reimplementing verification.

**This dissolves the `auth` kind question.** The two provision so differently
that a shared kind would be nearly empty: better-auth owns a database, a surface
and a secret (`rest-api` + `secret`, accurate), while OIDC owns a client secret
and nothing else (`secret`, also accurate). Neither needs a kind of its own.

**Revisit when** `OidcAuth` is actually written — that is when the neutral shape
becomes discoverable rather than guessed, and when the naming pays for itself.

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

## 6b. Dokploy as a Pulumi provider — *prototyped, undecided*

`packages/cli/src/deploy/` is a deployment engine written by hand. It calls
Dokploy's REST API, and it remembers what it created — `deploy/state.ts`,
`SSMStateProvider` — so the next deploy finds the same resources. That second
half is the interesting one, because **remembering what you created is the entire
job of a Pulumi state file**.

`@geekmidas/cloud/dokploy` is one resource, prototyped to see whether the shape
holds: an `Application` as a `pulumi.dynamic.ResourceProvider` with
create/read/update/delete/diff. SST uses this same escape hatch wherever official
provider coverage stops (`vercel/providers/dns-record.ts`,
`cloudflare/providers/kv-data.ts`), so the pattern is not exotic.

**What it would buy**

- A whole subsystem deleted rather than refactored: state tracking is the
  provider's, not ours.
- `pulumi preview` for the server target, which has no equivalent today.
- One adapter shape across both targets — `fromManifest` is already a table of
  provisioners, and `--target=server` becomes another table rather than a
  parallel engine.
- Better coverage where it is worst. Every currently failing test in this repo
  lives in `deploy/`.

**What has to be answered first**

- **Where Pulumi state lives for a non-AWS target.** `SSMStateProvider` is
  precedent that this is answerable, but it is the first question.
- **`delete` is the risky half.** Today's engine fails loudly when it cannot find
  something. A provider that gets destroy wrong leaves resources behind that
  Pulumi believes it removed — silent, and worse than the failure it replaces.
- **SST or plain Pulumi.** SST's value is its AWS components; a Dokploy-only
  stack may want Pulumi directly, with SST kept for the AWS target.

**Three things the prototype already surfaced**, which are the reason to
prototype rather than plan:

1. **The provider is serialised into state**, so its functions must be
   self-contained. That is why the API token is an *input* rather than something
   closed over, and why the prototype calls `fetch` directly instead of reusing
   `DokployApi` — a class imported from another module would have to serialise
   with it, and the failure when it cannot is obscure.
2. **Outputs must be declared as undefined inputs** or Pulumi never populates
   them. A quiet rule, and the usual first thing to get wrong.
3. **`diff` is where the design lives.** Dokploy derives `appName` from the
   application's name, so a rename is a *replacement* rather than an update —
   and saying so is what makes preview warn before the destroy instead of
   reporting it after. Casing-only changes are not replacements, which the tests
   pin, because destroying an application to restyle its name in the UI would be
   a spectacular way to lose one.

Nothing has run against a real Dokploy server.

## 6c. The CLI and what it scaffolds — *partly done*

The model reached the CLI's own output late. Reconcile only runs when an app
configures a `constructs` glob — `usesConstructs` is a hard switch — and
`gkm init` did not emit one, so every project the CLI produced took the
pre-constructs path and the engine was unreachable from the tool that generates
its users. Single-app templates now declare: a `KyselyDatabase`, plus
`ObjectStorage`, `Cache`, and `Email` for what init selected, with the glob that
makes reconcile read them.

### 6c.1 The fullstack workspace — *work*

It stays on the pre-constructs path, and deliberately: the auth app's database
role is created by `docker/postgres/init.sh` and its URL comes from a per-app
secret, neither of which reconcile knows about. Declaring only the API's half
flips the whole workspace onto reconcile — the switch is per *workspace*, not
per app — and leaves auth pointing at a container that is no longer the one
running.

It moves when the auth app declares its own half, most likely as a
`database.schema()` tenant of the API's database: that is exactly the kind whose
whole purpose is a second app with its own role, its own schema, and its own
URL. What has to move with it is the per-app secret that carries `DATABASE_URL`
today, since the tenant publishes its own key.

### 6c.2 A generated `docker-compose.yml` nothing reads — *work*

`gkm init` still writes one at the project root, and on the declared path
reconcile writes its own at `.gkm/docker-compose.yml` and never reads that one.
A stale file pinning a Postgres version and a database name beside a declaration
that decides both is the duplication this design removes, restated in the
scaffold. Removing it for single-app projects is a gate at the call site plus
four test rewrites; the fullstack path still needs its copy until §6c.1 lands.

### 6c.3 The glob is a switch with a sharp edge — *documented, no action yet*

Because derived containers are ignored rather than obeyed, adding a `constructs`
glob to an existing project **removes** its Postgres and MinIO until it declares
the database and the bucket that imply them. That is the intended semantics —
a config and a declaration that disagree is the failure the model exists to
remove — but it is a migration hazard with no warning attached. The cheap
version is a diagnostic: a glob is configured, `services.db` is set, and no
`database` kind was discovered, so say which container is about to disappear and
why.

### 6c.4 `secret` has no construct — *by design*

Twelve of the thirteen provisionable kinds are declared by a construct anyone
can instantiate. `secret` is not: it is emitted by `BetterAuth` for its signing
key, and nothing else declares one. This is the lifecycle split §3 argues —
a secret is generated and rotated by the platform, so there is nothing for an
author to pass. Recorded because "every kind has a construct" is otherwise the
obvious thing to assume, and it is off by one.

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

### 7.3 Two spellings of `search_path` — **resolved**

Neither spelling survives. `search_path` is now pinned on the *role* by
`ALTER ROLE … SET search_path` and leaves the URL entirely, except for the
cluster master, which has no role of its own to pin it on. A connection string
that has to remember it is one that eventually forgets, and the forgetting looks
like an empty database rather than an error.

`@geekmidas/cli` does now depend on `@geekmidas/db`, for the shared role and URL
generators — the layering question that had held this up, answered by there
being two callers rather than one.

### 7.4 Test suites that need containers — *environment*

The `@geekmidas/events` half is **resolved** — it has a vitest config, and its
specs are discovered. What that surfaced remains: the RabbitMQ and pg-boss ones
need brokers, as do the Postgres-bound integration specs in `constructs` and the
LocalStack-bound `deploy` specs in `cli`.

Worth knowing, because it is louder than a skipped suite: with nothing running,
`vitest list` at the repo root fails during **collection** with an
`ECONNREFUSED` aggregate error rather than reporting the tests it could not
reach. A collect-time connection is why — the failure is in enumerating the
suite, not in running it.

None of this is new breakage — it is previously invisible breakage now visible,
plus a documented port conflict with another project on 5432/4566/8079.

### 7.5 Dev-server resilience — *parked, documented*

See [dev-server-resilience-design](https://github.com/geekmidas/toolbox/blob/main/packages/cli/docs/dev-server-resilience-design.md).
The supervisor, the tsx PID registry, and worker-thread hot reload are designed
and unbuilt; the Zod duplicate-id error on HMR is subsumed by the last of those
and is worked around today by clearing the registry in `discover` and the
generators.

---

## 8. What has not been verified

Stated plainly, because "tests pass" and "it works" are different claims.

- **Nothing has been deployed.** No AWS credentials in this environment; the AWS
  target's six provisioners are verified as pure decisions, not as a stack.
- ~~**The file server has not run against MinIO.**~~ **Resolved.** It has, from
  an empty volume: a presigned `PUT` that accepts bytes, the object readable
  unsigned at the declared `open` prefix, and `403` on a path that is not on the
  list. The bucket policy is applied and enforced, not asserted as a document.
- ~~**kitchen-sink has not been re-run end to end.**~~ **Resolved, and it is a
  suite now** rather than a session someone remembers — `pnpm test` in
  `apps/kitchen-sink`, 28 assertions against the reconciled `test` stage, run
  cold from a dropped database and warm. Magic-link sign-in through Mailpit,
  `user.created` *and* `user.updated` fanning out into rows, the queue worker
  sending the welcome mail exactly once, the cache serving and being
  invalidated, and the presigned upload above.

  It drives the **generated entry point** — the same `.gkm/server/app.ts` that
  `gkm dev` runs — which is the half that had never been covered: driver
  registration lives there, and a driver that disagrees with the URL the target
  composed is invisible to every unit test in the repo. That was a real bug, and
  it is now a test.

  What the run found, all fixed: the cache backend ignored in four places, a
  schema owned by a role that could not create in it, `services` dropped on the
  way to the entry point, two caches in one database sharing a table, and
  `gkm test` filtering away the very URLs it had just resolved.
- **The database bootstrap has never run.** Its decisions are asserted as pure
  data — the event it composes is fed straight into the DDL generator in a test
  — but no Lambda has connected to a real cluster.
- **No mail has been sent through SES**, so the SMTP password derivation is
  verified against the documented algorithm and not against the service. See
  §1.3.
- **No cache backend has run outside its tests** *except the Postgres one*,
  which now does on every reconcile: the table is created in the tenant's
  schema, owned by its owner, and read through the URL that carries its name.
  The ElastiCache cluster has still never been created.
- **The `sns` events backend has no local target.** `UnprovisionedEventsBackend`
  says so rather than composing a URL that would fail at the first publish: SNS
  and SQS are addressed by ARN, and nothing creates the topic, the queue or the
  subscription in the emulator. The event clients already accept a custom
  endpoint, so what is missing is a provisioning step beside the one that
  creates buckets in MinIO — and until it lands, the claim that the same
  handlers drain pg-boss here and SQS deployed is asserted rather than tested.
  `pnpm test:sns` in kitchen-sink is the switch, and it fails on exactly this.

---

## Suggested order

Not a plan, a suggestion — the decisions in §1 and §3 belong to whoever owns the
bill and the security model, and the rest follows them.

1. **A real deploy** — §1.1 and the bootstrap are the largest untested surface
   in the repo, and everything below is easier to trust once one stack has come
   up. Re-running kitchen-sink locally against the new roles is the same point
   in miniature and costs minutes.
2. **§2 the endpoint merge** — unblocks `rest-api` on AWS and per-route IAM, and
   is the largest remaining piece of correctness debt in the model.
3. **§5 kitchen-sink frontend** — makes four already-built derivations observable
   rather than merely tested, and is cheap.
4. **§6c.1 the fullstack workspace** — the last path that still declares its
   infrastructure twice, and the one a new user is most likely to meet, since it
   is one of the two templates the init prompt offers.
5. **§7.2** — small, and the kind of gap that hides others.
