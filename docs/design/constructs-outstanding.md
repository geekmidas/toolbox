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

### 4.2 The local CDN-shaped host — **resolved**

`UPLOADS_SERVER_URL` is `https://<server>.<project>.localhost:<port>` — a host
of its own, over TLS, which is the shape it has deployed. A **Caddy** container
does the mapping, derived from the declaration exactly as MinIO is: a
`file-server` implies the edge, and the generated Caddyfile gives each declared
server a host that rewrites its bucket in as a prefix.

Not a CDN, deliberately. Varnish, Apache Traffic Server and the rest are
*caching* layers, and caching is not what was missing — the mapping and the
certificate were. **An AWS emulator supplies neither:** CloudFront emulation in
floci is control plane only — distributions, origins, behaviours, invalidations
— which provisions a distribution that never serves a byte.

The leading label is the *server's* stage-scoped name rather than the bucket's,
which is what fixes the case MinIO could never serve: two servers over one
bucket are a legitimate arrangement — two cache behaviours, one origin — and
naming the host after the bucket collides them.

Three things fell out of it that are worth more than the shape:

- **Local HTTPS.** Caddy issues per-host certificates from its own CA.
  Reconcile copies the root out of the container and injects
  `NODE_EXTRA_CA_CERTS`, so Node and the test suite trust it with no `sudo` and
  nothing installed; a browser wants a one-time `caddy trust`.
- **One edge, every stage.** The root Caddyfile only imports; each stage writes
  `.gkm/caddy-sites/<stage>.caddy`. A single file would have meant `gkm test`
  deleting the routes `gkm dev` is serving — the first artefact where two
  stages could collide, since one Postgres already holds `orders` and
  `orders_test` without trouble.
- **An assigned port, not 443.** The whole point of allocation is that two
  projects run at once, and an edge insisting on the privileged port puts that
  back. Nothing that reads a hostname — a cookie domain, a CORS origin — looks
  at the port.

Still open, and it is the interesting half: **the edge does not verify
signatures.** Caddy cannot check a CloudFront signed URL or cookie — that is RSA
against a key group, and nothing declares key material yet (§4.1) — so a signed
read is still an S3 presign at the bucket. The proxy that could verify one is
now a *replacement* for the reverse-proxy block rather than a new component,
which is a much smaller job than it was.

**Surfaces and sites are behind it too**, which was the larger prize and is the
reason the edge is not a file-server feature. `EDGE_KINDS` is the whole of the
list, so adding a kind to it is adding it to the edge; a file server routes to
the object store with its bucket rewritten in, while a surface and a site route
to the process `gkm dev` started on the host.

What that buys is the cookie model. On `http://localhost:<port>` every address
is one host with a different port, which shares no parent, so `cookieDomain`
correctly derived *nothing* — a different model from the deployed one rather
than a less secure version of it. Behind the edge kitchen-sink resolves
`AUTH_COOKIE_DOMAIN=.kitchen-sink.localhost`, and the trusted-origin list is the
sibling's real origin rather than a port.

Two things this made explicit, both now stated in code:

- **The application cannot tell.** It reads whichever address was injected and
  composes none, so `edge: false` falls back to `http://localhost:<port>` and
  the path-style bucket address without a line of application code changing.
  That is what makes this the target's decision rather than an API.
- **Origins and cookie domains derive from *resolved* addresses**, not from the
  ones the workspace assigned. `envFor` resolves every construct before any
  surface reads its callers, because reading them as the loop reached them
  would make the answer depend on the order the manifest was keyed in.

### 4.3 `--target=server` — *the old decision is superseded*

The recorded decision was **"MinIO, the same way local works — path-style, with
the same bucket policy."** That no longer describes local: §4.2 landed, and a
file server now answers on a host of its own over TLS. Keeping it would
reintroduce a path-style address on exactly one target, which is the drift the
model exists to remove.

What replaces it depends on which server target, and they are not the same:

- **A bare `--target=server`** — nothing supplies an ingress, so the same
  generated Caddyfile is the answer. `sitesFor` → `toCaddyfile` already produces
  it; what differs is the upstream and real certificates instead of the internal
  CA. Cheap, and it keeps every target the same shape.
- **Dokploy** — it *is* the ingress. It runs Traefik and issues Let's Encrypt
  certificates, and the deploy path already creates domains with
  `https: true, certificateType: 'letsencrypt'`. A second reverse proxy behind
  the first would terminate TLS twice and give a route two places to be wrong.
  So MinIO becomes a Dokploy service with a domain of its own, exactly as the
  API does, and no Caddy.

Neither is reachable yet, for a reason larger than the file server — see §6b.

**And the open paths do not survive the trip.** `bucketPolicies()` and
`bucketPolicy()` already turn `open: ['brand/**']` into an anonymous
`s3:GetObject` policy on those prefixes, and MinIO accepts an S3 bucket policy
verbatim — so the mechanism needs no porting. What is missing is upstream of it:
both take the *local reconcile plan*, and the Dokploy provisioner table has no
`objects` entry and no `file-server` entry, so the bucket is never created there
and the policy is never applied. A deploy that reached this point would serve
nothing publicly and report no error, which is the same shape of silence as a
kind being skipped. One provisioner, not a feature.

### 4.4 A known asymmetry — *documented, no action*

A single `*` is **stricter in the client than in the S3 policy**. The construct's
runtime check stops at a segment boundary, matching a CDN behaviour; an S3 policy
resource's `*` crosses `/`. So `avatars/*.png` admits `avatars/2024/me.png` in
the policy and is refused by the client. The client is the stricter of the two,
so nothing it refuses was ever relied on the policy to refuse — but a key fetched
directly, bypassing the client, can be admitted. Prefer `**` where crossing
segments is what you meant.

### 4.5 Cache rules do not exist — *undesigned, not a Dokploy gap*

`FileServerDeclaration` is `of` and `open` and nothing else. There is no `maxAge`,
no `Cache-Control`, no TTL, on any target.

Worth stating because the code reads as though there were. `file-server.ts:58`
says a pattern is enforced "by the bucket policy, by **the cache behaviour**, and
by this construct's own runtime check" — and that is CloudFront's *path-pattern
behaviour* being used as the signing boundary. It is an authorization mechanism
that happens to be named cache, and reading it as a caching feature suggests a
port to Dokploy that has no source to port from.

If it is wanted, note that it lands three different ways at the edge — a
CloudFront cache policy, Traefik middleware, a `header` directive in the
Caddyfile — while `Cache-Control` set as **S3 object metadata at upload time**
behaves identically on all three, because it travels with the object rather than
with the edge. `getUploadURL` already presigns the PUT, which is the natural
place to carry it. That would make a cache rule a property of the object rather
than a rule three targets have to agree on.

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

## 6b. Dokploy — *a pipeline now, and it has never run*

**This was the largest gap in the repo, and it is now the least verified thing
in it.** The first slice is built; nothing has deployed.

What the gap was, because the shape of the fix follows from it:
`packages/cli/src/deploy/` contained no reference to `reconcile`, `discover`,
`envFor`, or the construct manifest — checked, not remembered. It resolves
environment entirely from the **sniffer**, which walks application code for
`get('X')` calls. A construct reads its own key *inside* `@geekmidas/constructs`,
so there is no `get('UPLOADS_URL')` in an app to find: the same blind spot that
was silently dropping 12 of 25 declared URLs in `gkm test` until §7.4's work.

So a declared app deployed to Dokploy today gets **none** of the model. No
database roles, no schema tenants, no cache table, no broker connection string,
no bucket, and none of the declared URLs. The only buckets `deploy/` knows about
are database *backup* destinations.

The failure mode is the bad kind. Nothing provisions `Uploads`, nothing resolves
`UPLOADS_URL`, and nothing *reports* it missing — because the sniffer never
learned it was needed. The deploy succeeds, the app starts, and the first upload
fails inside the construct at runtime.

The two targets are therefore not two targets for one model: the AWS target
reads the manifest and Dokploy is what came before it. Everything below was
written as "should Dokploy become a Pulumi provider?", and it is still a good
question — but it is now the *second* one. `fromManifest` is already a table of
provisioners keyed by kind, which is exactly the shape a Dokploy target needs,
and that is an argument for the provider rather than a separate concern.

### What is built

The provisioner table exists: `packages/cli/src/deploy/fromManifest.ts`, keyed by
declaration kind over the REST wrapper, with `declared.ts` running it and the
deploy applying what it defers. Covered today:

| kind | on Dokploy |
|------|-----------|
| `database` | a Dokploy Postgres, plus roles from the shared generator |
| `database-schema` | a schema in the parent's cluster, own role, own URL |
| `database-reader` | the writer's endpoint through a read-only role |
| `cache` | a table in the declared database, its name in the URL |
| `secret` | derived from project and stage, stable across deploys |
| `rest-api` | the domain Dokploy issued, via its own Traefik |
| `objects`, `file-server`, `email`, `queue`, `topic` | **skipped** — no Dokploy primitive; Compose stacks, and a decision nobody has taken |

Three properties worth stating because they were decisions, not accidents:

- **The DDL is the shared one.** `roleStatements` and `cacheTableStatements`,
  the same generators the local and AWS targets call. The hand-rolled `DO $$`
  block in `initializePostgresUsers` is gated on *not* having adopted the model
  and marked deprecated — its only remaining caller is §6c.1.
- **A kind with no primitive is skipped, not fatal.** Refusing to deploy an app
  because it also declares a bucket would be worse than deploying it without
  one. The cost is honest: the key is absent, and the construct says so on first
  use.
- **Nothing has run against a real Dokploy server.** Twenty-seven assertions
  cover the decisions against a fake REST wrapper. The decisions are verified;
  the integration is not — the same distinction §8 draws for AWS.

### Where the state is, and what the declared half does not put in it

Deploy state is a `StateProvider`: `LocalStateProvider` writes
`.gkm/deploy-<stage>.json` by default, and `state: { provider: 'ssm' }` wraps
SSM Parameter Store as the source of truth with that file as a cache. It holds
the Dokploy project and environment ids, application ids, service ids, per-app
credentials, generated secrets, DNS records and backup state.

**The declared half writes none of it**, and that is the interesting part. It
finds a Postgres by name and creates one if absent, and it *derives* every
password from `project:stage:role`. So there is nothing to remember: the name is
the identity and the credential is a function. Reconciling twice converges
without a file, which is the same property the local target has.

That sharpens the question below rather than answering it. "Remembering what you
created is the entire job of a Pulumi state file" is a strong argument for the
half that genuinely remembers — domains, DNS records, backup destinations,
application ids — and no argument at all for the half that does not. A provider
wrapping the declared table would be adding state to something that had shed it.

The cost of statelessness is worth writing down too: **a renamed construct
orphans what the old name created.** `findOrCreate` makes a new Postgres and
nothing removes the old one, because nothing recorded that it was ours. The
local target has the same behaviour and it matters less there.

### The engine that exists

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
- Better coverage where it is worst. `deploy/` is the least covered subsystem —
  though no longer the failing one: those suites pass now that §7.4 starts the
  emulator they are written against.

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

### The application is named by its image, and serves two surfaces

Two findings from the first deploy that reached Dokploy, both about the same
thing: an application is created before anything has read the manifest.

**It carries no stage.** The name comes from `docker.imageName`, so the database
beside it reads `production-kitchen-sink-database` — scoped, from `cloudName`,
the rule the AWS target uses — and the application reads `kitchen-sink`.
Deploying `staging` into the same project would match that by name and redeploy
production. The fix is not to scope this name but to stop deriving it here: an
application serves a `rest-api`, and the declaration that names the surface
should name the container. That needs the manifest discovered *before*
applications are created rather than after — a reordering, not a rename, which
is why the interim scoping was reverted rather than shipped.

**It serves two surfaces in one process.** `Api` and `Auth` are both `rest-api`
declarations, and the auth half is mounted by a server hook whose own comment
says it "goes away when the build emits surfaces". `constructs-paradigm.md`
already decided this — *"The auth server is its own surface"* — with its own
scaling, blast radius and `AUTH_URL`.

**§2 blocks the general case but not this one.** A surface cannot drive route
generation because `RestApi` declares `endpoints: []` and the build never fills
it, so `Api`'s routes still come from the glob. But `Auth` is self-describing:
`auth.ts:154` declares its `rest-api` node with the endpoint already on it —
`ANY {basePath}/*` → `Auth.handler`, with its dependencies and required secret.
So the auth server can be generated from the manifest today.

Two things stop being degenerate when it is. `cookieDomain` currently returns
nothing because there is one host; with `api.` and `auth.` under one domain it
derives a real parent, which is the case it was written for. And
`surfaceAddresses` stops handing every surface the same address under a comment
apologising for it.

---

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

### 7.4 Test suites that need containers — **resolved**

A suite now starts what it needs. `ensureServices` in
`packages/testkit/test/services.ts` runs `docker compose up -d --wait` for the
named services, and the packages that connect to something call it from their
`globalSetup`: `db` and the Postgres-bound `constructs` specs get Postgres,
`cache` gets Redis and the HTTP proxy in front of it, `cli` gets the AWS
emulator its `deploy` specs drive.

**This is what `gkm test` already did for an application**, and the gap was that
the toolbox's own suites did not use it. `gkm test` reconciles what an app
declares and starts exactly those containers — which is why kitchen-sink's suite
needs no setup at all. A package suite has no manifest to read, so its
containers come from the repo's own `docker-compose.yml`, and nothing started
that.

What it cost was not "a few skipped tests". A `globalSetup` that connects at
collection time takes the whole *project* down with `ECONNREFUSED` when its
database is missing, so a package reported **zero** tests rather than the ones
it could have run. `packages/cache` compounded it by having no vitest config at
all: five suites, 79 tests, never once executed.

The visible result: **the repo has no failing tests.** The 16 in `deploy/` were
never broken — nothing had started the emulator they are written against, and
they pass the moment something does. Recreating a container whose definition has
drifted falls out of the same call, which matters more than it sounds: a
container created from an older compose file, running and healthy with its ports
unpublished, is unreachable in a way that reads like a code failure.

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
- **The declared DDL has not been applied on Dokploy.** The statements are
  generated and the cluster is created; what has not completed is the applier
  running against it, because the deploy now stops earlier — see the suggested
  order. Locally and in the fake this path is covered; against a real Dokploy
  Postgres it is not.
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

1. **A real Dokploy deploy** — *begun, not finished.* It reaches the server now:
   the project is found, the application created, and
   `production-kitchen-sink-database` created under the scoped name, with eleven
   declared URLs resolved. Two of the three things this predicted trouble from
   were right. The external-port dance is the fragile part — the port is only
   reachable while published, and a container restarting around that change
   drops the SYN rather than refusing it, which is now bounded and retried three
   times. What stops it today is neither: the bundle step refuses to build
   without `MAIL_URL`, `MAIL_FROM`, `UPLOADS_URL` and `UPLOADS_SERVER_URL` —
   the two kinds with no Dokploy provisioner, §4.3 and §1.3. So the role DDL
   against Dokploy's Postgres is still the untested half.
2. **A real deploy** — §1.1 and the bootstrap are the largest untested surface
   in the repo, and everything below is easier to trust once one stack has come
   up.
3. **§2 the endpoint merge** — unblocks `rest-api` on AWS and per-route IAM, and
   is the largest remaining piece of correctness debt in the model.
4. **§5 kitchen-sink frontend** — makes four already-built derivations observable
   rather than merely tested, and is cheap.
5. **§6c.1 the fullstack workspace** — the last path that still declares its
   infrastructure twice, and the one a new user is most likely to meet, since it
   is one of the two templates the init prompt offers.
6. **§7.2** — small, and the kind of gap that hides others.
