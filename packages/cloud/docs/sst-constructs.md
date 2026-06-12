# `@geekmidas/cloud/sst`

Reusable SST v4 (ion) constructs for building AWS applications: opinionated,
linkable wrappers around SST's native components with sensible defaults,
environment-variable validation, and a shared app/stack context.

First iteration ships **`Function`**, **`Api`**, and **`Cron`**, plus the
supporting **`App`**, **`Stack`**, and **`Linkable`** foundation.

---

## 1. Overview

`@geekmidas/envkit/sst` provides the **runtime + vocabulary** half of SST
integration: `ResourceType`, `sstResolvers`, and `SstEnvironmentBuilder`, which
turn SST resource link objects into flat environment variables at runtime. It is
a normal buildable module (no SST dependency) and is the single home for the
resolver/validator pair (§7).

`@geekmidas/cloud/sst` provides the **infra-time** half — the constructs you
instantiate inside `sst.config.ts` to declare functions, APIs, and crons. They
import the vocabulary and validator from `@geekmidas/envkit/sst`, so a resource
linked at infra-time resolves to predictable environment variables at runtime
and can be validated *before* deploy.

```ts
import { App, Stack, Api, Function, Cron } from '@geekmidas/cloud/sst';
```

### The goal: validate deployments before they run

The reason these constructs exist is **pre-deploy validation**. Each construct
maps 1:1 to a deployable unit (a `Function` — directly, or one per `Api` route,
or a `Cron`'s target). For each unit we know two things at infra time:

1. the **links** (`Linkable`s) it consumes, and
2. the **environment variables it requires** (its declared `envVars`).

Because env vars are resolved from links by the `@geekmidas/envkit/sst`
resolvers, and because the resolved **keys** are a pure function
of `(link name, ResourceType)` — independent of the (still-unresolved) SST
`Output` *values* — we can run that same resolution at infra time to compute the
exact set of env-var keys a unit will have once deployed. Comparing that set
against the unit's required `envVars` lets us fail **before** `sst deploy` ever
provisions anything, with a precise "function X is missing `DATABASE_URL`"
message instead of a runtime crash in production. See §7 for the model.

---

## 2. Distribution: source-only subpath

In SST v4 (ion) the infra component types are **not published to npm**.
`sst.aws.Function`, `sst.aws.ApiGatewayV2`, `sst.aws.Cron`, `sst.Linkable`,
`$util`, and `$app` exist only inside `.sst/platform/`, which `sst install`
generates and exposes as **ambient globals** (`.sst/platform/config.d.ts`
declares `aws`, `$config`, etc.). The `aws`/`gcp` globals re-export
`@pulumi/aws`/`@pulumi/gcp`; `$util` is `@pulumi/pulumi`.

Because of this, a construct that does `class Api extends sst.aws.ApiGatewayV2`
cannot be type-checked or compiled to `.d.ts` in isolation — its base class only
exists inside an `sst install`ed workspace.

**Therefore `./sst` is distributed as raw TypeScript source.** It is consumed
inside the user's SST app, where `tsx`/esbuild and the `.sst/platform` ambient
globals are already in scope. The rest of `@geekmidas/cloud` (`.` and `./utils`)
continues to build to dual ESM/CJS `dist` with generated `.d.ts`.

### `package.json`

```jsonc
{
  "exports": {
    ".":       { "import": { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" },
                 "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" } },
    "./utils": { "import": { "types": "./dist/utils/index.d.mts", "default": "./dist/utils/index.mjs" },
                 "require": { "types": "./dist/utils/index.d.cts", "default": "./dist/utils/index.cjs" } },
    "./sst":   "./src/sst/index.ts"
  },
  "peerDependencies": { "sst": "^4.15.2" }
}
```

### `tsdown.config.ts`

`./sst` must be excluded from the build. List explicit entries:

```ts
export default defineConfig({
  entry: ['src/index.ts', 'src/utils/index.ts'], // src/sst/** is NOT built
  clean: true,
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  outExtensions: (ctx) => ({ js: ctx.format === 'es' ? '.mjs' : '.cjs' }),
});
```

### `tsconfig.json`

The package type-check must skip `src/sst` (its globals only exist in the
consuming app):

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src", "composite": true },
  "include": ["src/**/*"],
  "exclude": ["src/sst/**"]
}
```

---

## 3. Module structure

```
packages/cloud/src/sst/
├── index.ts          # public surface for ./sst
├── App.ts            # application context (stage, region, domain + Route53)
├── Stack.ts          # stack context wrapping App
├── Linkable.ts       # linkable base + ResourceType discriminator
├── Function.ts       # wraps sst.aws.Function
├── Api.ts            # wraps sst.aws.ApiGatewayV2
└── Cron.ts           # wraps sst.aws.Cron
```

### `index.ts`

```ts
export { App, type AppProps } from './App';
export { Stack, type StackType } from './Stack';
export { Linkable, type GkmLinkable, ResourceType } from './Linkable';
export { Function, type FunctionProps, type Handler } from './Function';
export { Api, type ApiProps, type Route } from './Api';
export {
  Cron,
  type CronProps,
  type CronSchedule,
  type CronExpression,
  type CronRate,
} from './Cron';
```

---

## 4. `App`

Application-level context. A plain **synchronous constructor** — `new App({…})`
— that takes an **already-resolved** hosted zone. Zone resolution is the
caller's responsibility: either a one-time `aws.route53.getZone` at the top of
`sst.config.ts` (whose top level is async), or `getZoneOutput()` for a lazy
`Output`, or a dedicated `Domain` linkable that carries the id. This keeps every
construct uniform (`new X(…)`) and decouples DNS lookups from app construction.

```ts
// Resolve once, where async is allowed (sst.config.ts top level):
const { zoneId } = await aws.route53.getZone({ name: 'example.com' });

const app = new App({
  name: 'my-app',
  stage: 'prod',
  domain: 'example.com',
  hostedZoneId: zoneId,      // resolved by the caller, passed in
  region: 'us-east-1',
});
```

> Earlier drafts used an `await App.create({…})` async factory so the constructor
> could `await aws.route53.getZone(...)` (a constructor can't be `async`). Moving
> the resolved zone into props removes that special case — the lookup happens once
> at the call site, and `hostedZoneId` also accepts an `Output<string>`, so
> `getZoneOutput()` works without any `await` at all.

**Props**

| Prop | Type | Notes |
| --- | --- | --- |
| `name` | `string` | App name; part of resource name prefixes. |
| `stage` | `TStage` (string) | Deployment stage (e.g. `dev`, `prod`). |
| `domain` | `TDomain` (string) | Root domain backed by a Route53 hosted zone. |
| `hostedZoneId` | `` $util.Output<string> \| string `` | Pre-resolved zone id (caller-supplied). |
| `region` | `string` | AWS region. |

**Members**

- `hostedZoneId` — the supplied zone id; no internal lookup.
- `stack(name)` — factory that returns a `Stack` bound to this app (see §5).
- `select(prodValue, other)` — returns `prodValue` when `stage === 'prod'`,
  else `other`.
- `getSubdomain(sub)` → `` `${sub}.${domain}` ``.
- `getURL(sub?)` → `` `https://${sub}.${domain}` `` (or `https://${domain}`).
- `logicalPrefixedName(id)` — kebab-cased, stage/name-prefixed resource name.

## 5. `Stack`

Thin context object wrapping an `App`, scoped to a logical stack name. Created
via `app.stack(name)` — a factory on `App` that binds the new stack to its app —
rather than `new Stack(app, name)` directly:

```ts
const stack = app.stack('api');
stack.logicalPrefixedName('handler'); // "prod-api-handler"
```

`app.stack(name)` is sugar for `new Stack(app, name)`; the constructor stays
available for cases that need it, but `app.stack(...)` is the intended entry
point (the app is already in scope, so there's nothing to pass).

Exposes `stage`, `region`, `domain` (delegated to the app), plus
`logicalPrefixedName`, `select`, `getSubdomain`, and `getURL`.

## 6. `Linkable`

Base class for linkable constructs. Carries a `_type` discriminator drawn from
`ResourceType`, which is shared with the `@geekmidas/envkit/sst` resolvers so
that linked resources resolve to predictable environment variables via
`SstEnvironmentBuilder`.

No new `ResourceType` members are added: `Function` reuses `ResourceType.Function`
and `Api` reuses `ResourceType.ApiGatewayV2`, both of which already exist (with
`noop` resolvers) in `@geekmidas/envkit/sst`. `Cron` is not a link target and is not
`Linkable` (see §11.3). Constructs that wrap a native SST component and need no
additional linkable properties rely on SST's native link type directly;
`Linkable` is used only where a construct exposes extra properties beyond what
SST emits natively.

---

## 7. Validation model

This is the point of the package (§1). Validation reuses the **runtime**
resolver so that what we check at infra time is exactly what the function gets at
runtime — they cannot drift.

### Where this lives: `@geekmidas/envkit/sst`

The vocabulary (`ResourceType`), the runtime resolver (`SstEnvironmentBuilder` /
`sstResolvers`), and the infra-time validator (`EnvValidator` / `resolveEnvKeys`)
all live together in **`@geekmidas/envkit/sst`** — a normal **buildable** module
(it ships `dist` with `.d.ts`; it has no SST runtime dependency). The
source-only `@geekmidas/cloud/sst` constructs (§2) `import { EnvValidator }`
from it and call `.assert(envVars)` in their constructors.

The split is deliberate: the validator is pure TypeScript and *can* build to
`dist`, so it should not be dragged into the source-only distribution. Keeping
it beside the runtime resolver in one package is what makes drift impossible —
they share the **same** `sstResolvers`.

> `@geekmidas/cloud/utils` currently carries an older, diverged copy of
> `ResourceType`/`buildResourceEnv` (no Dynamo, no colon-notation, no derived
> `Url`). It has no external consumers, so it should be folded onto
> `@geekmidas/envkit/sst` and `@geekmidas/cloud` should depend on envkit.

### Keys are derivable; values are not

`sstResolvers` map each link to flat env vars. The mapping splits into two
concerns:

- the **key shape** — which env-var names a link produces — depends only on the
  link's `name` and its `ResourceType` (e.g. a `Postgres` link named `db`
  produces `DB_NAME`, `DB_HOST`, `DB_PASSWORD`, `DB_PORT`, `DB_USERNAME`,
  `DB_URL`; a `Bucket` produces `<NAME>_NAME`; a `SnsTopic` produces
  `<NAME>_ARN`; a `Secret` produces the bare `<NAME>`; `Function`/`Api`/`Vpc`
  produce nothing).
- the **values** are SST `Output`s, unresolved until deploy.

Validation only needs the key shape, so it runs without resolving any `Output`.

### Single source of truth — replay the resolvers, don't duplicate them

Every resolver's output *keys* are value-independent, so the validator does not
need a parallel suffix table to maintain. `resolveEnvKeys` derives the available
keys by **replaying the same `sstResolvers`** with a placeholder value and
taking `Object.keys`:

- `SstEnvironmentBuilder(record).build()` (runtime) — produces `{ key: value }`.
- `resolveEnvKeys(links)` (infra time) — runs the same resolvers over a sentinel
  value and returns the `Set<string>` of keys, with no real values.

A new `ResourceType` only has to add a resolver once; both paths pick it up. A
`noop` resolver contributes no keys. (This is stricter than maintaining a
separate `ENV_VAR_SUFFIXES` table, which can silently fall out of sync with the
resolvers it mirrors.)

### The check

For a deployable unit with required vars `envVars`, explicit `environment`, the
construct's `defaults`, a `platform`, and `links`:

```
available = keys(defaults) ∪ keys(environment) ∪ resolveEnvKeys(links)
                                                ∪ platformEnvVars(platform)
missing   = envVars.filter(v => !available.has(v))
```

A non-empty `missing` throws an `EnvValidationError` — a structured, catchable
error (with `.missing` / `.available` / `.suggestions` / `.context`) whose
message names the unit, lists the missing variables with a nearest-match **"did
you mean DB_URL?"** hint per variable, and shows the link-provided vars. With
`autoValidate` (default `true`) this runs in the constructor, so a misconfigured
`sst.config.ts` fails at synth time, before any cloud call.

**Platform whitelist — exported, never assumed.** A platform injects its own
always-valid runtime variables (`AWS_REGION` on Lambda, `GOOGLE_CLOUD_PROJECT`
on GCP, …). The validator does **not** bake any of these in — SST deploys to AWS,
GCP, and Cloudflare, so assuming AWS would be wrong elsewhere. Instead
`@geekmidas/envkit/sst` *exports* the per-platform sets (`AWS_RUNTIME_ENV_VARS`,
`GCP_RUNTIME_ENV_VARS`, `CLOUDFLARE_RUNTIME_ENV_VARS`, the `PLATFORM_ENV_VARS`
registry, and `platformEnvVars(platform)`), and the caller opts in by passing the
construct's target `platform`. Omit it and no platform variables are trusted.

### 1:1 mapping to deployable units

| Construct | Deployable unit(s) | Validated against |
| --- | --- | --- |
| `Function` | the function | its `envVars` vs. its `links` |
| `Api` | one Lambda **per route** | each route's `environment` vs. the API `links` |
| `Cron` | its target `Function` | the target's `envVars` vs. its `links` |

Each unit is validated independently, so one missing variable points at exactly
one function rather than a whole stack.

---

## 8. `Function`

Wraps `sst.aws.Function` with standard defaults and env-var validation.

```ts
const fn = new Function(stack, 'Processor', {
  handler: 'src/processor.handler',
  functionName: stack.logicalPrefixedName('processor'),
  links: [db, topic],
  envVars: ['DATABASE_URL'],     // validated against links
  environment: { CUSTOM_VAR: 'value' },
  nodejs: { install: ['some-package'] },
  layers: ['arn:aws:lambda:...'],
});
```

**Defaults applied**

- Environment: `NODE_ENV`, `SERVICE_NAME`, `STAGE`, `REGION`, `APP_NAME`.
- `runtime: 'nodejs24.x'` (overridable), `logging: { format: 'json' }`.
- `link` resolved from `links` filtered by the requested `envVars`.

**Props (selected)**

| Prop | Type | Notes |
| --- | --- | --- |
| `handler` | `` `${string}.handler` `` | Lambda entrypoint. |
| `functionName` | `string` | Physical name. |
| `environment` | `Record<string,string>` | Merged over defaults. |
| `links` | `GkmLinkable[]` | Pool of linkable resources. |
| `envVars` | `readonly string[]` | Required vars; validated against `links`. |
| `autoValidate` | `boolean` (default `true`) | Validate in constructor. |
| `nodejs` | `{ install?: string[]; externals?: string[] }` | Passthrough. |
| `layers` | `$util.Input<string>[]` | Additional Lambda layers. |
| `url` | `boolean` | Enable a function URL. |
| `vpc` | `sst.aws.Vpc` | Optional VPC. |

`validate()` re-runs validation and returns the result.

`_type = ResourceType.Function`.

---

## 9. `Api`

Wraps `sst.aws.ApiGatewayV2` (HTTP API) with a typed route table and per-route
environment validation.

`ApiProps` **extends `sst.aws.ApiGatewayV2Args`**, so every native option
(`cors`, `domain`, `accessLog`, `transform`, …) passes straight through
untouched — the construct imposes **no** API-level defaults of its own (CORS,
origins, etc. are entirely the consumer's call). The route table and
linking/validation inputs are added on top.

```ts
const api = new Api(stack, 'Api', {
  links: [db],
  domain: 'api.example.com',     // native ApiGatewayV2Args — passed through
  vpc: network.vpc,              // optional, applied per route
  cors: { allowOrigins: ['https://app.example.com'] }, // consumer's choice
  routes: [
    { method: 'GET',  path: '/users', handler: 'src/users.handler',
      environment: ['DATABASE_URL'], authorizer: 'iam' },
    { method: 'POST', path: '/public', handler: 'src/public.handler',
      authorizer: 'none' },
  ],
});
```

**Behaviour**

- API-level args (`cors`, `domain`, `accessLog`, …) are passed through verbatim;
  nothing is defaulted or overridden at the API level.
- Each route becomes a Lambda whose runtime defaults to `nodejs24.x` —
  overridable per route (`route.runtime`) or for the whole API (`runtime`) — with
  env merged from API defaults (`REGION`, `STAGE`, `NODE_ENV`, `APP_NAME`) plus
  `environment`.
- Each route's `link` is filtered to just the linkables that provide one of its
  required env vars (`EnvValidator.getProvidersForEnvVars`) — least privilege.

**`Route`**

| Field | Type | Notes |
| --- | --- | --- |
| `method` | `'GET'\|'POST'\|'PUT'\|'DELETE'\|'PATCH'\|'ALL'` | |
| `path` | `string` | |
| `handler` | `string` | Resolved relative to `root` (default `cwd`). |
| `environment` | `readonly string[]` | Required env vars; validated against `links`. |
| `authorizer` | `'iam' \| 'none'` | `iam` requires SigV4; `none` is public. |

Per-route env validation runs at construction; missing variables are collected
and throw a single aggregated error so misconfiguration fails fast at deploy
time.

`_type = ResourceType.ApiGatewayV2`.

---

## 10. `Cron`

Wraps `sst.aws.Cron`, invoking a `Function` on a schedule.

```ts
const cron = new Cron(stack, 'Nightly', {
  processor: fn,                         // a Function (or any { arn })
  schedule: 'rate(1 day)',
  links: [db],
});
```

**Schedule types** (pure TypeScript template-literal types, fully checked):

```ts
type CronExpression = `cron(${CronString})`;     // e.g. cron(0 12 * * ? *)
type CronRate = `rate(${number} ${'minute'|'minutes'|'hour'|'hours'|'day'|'days'})`;
type CronSchedule = CronExpression | CronRate;
```

**Props**

| Prop | Type | Notes |
| --- | --- | --- |
| `processor` | `Function` | Target invoked on schedule. |
| `schedule` | `CronSchedule` | Cron expression or rate. |
| `links` | `GkmLinkable[]` | Optional linked resources. |

`Cron` is not `Linkable` — nothing links *to* a cron — so it carries no `_type`
discriminator (see §11.3).

---

## 11. Decisions (iteration 1)

The questions raised during design are resolved below. Each favors the repo
principles — zero-config defaults, composability, and avoiding over-engineering
— and can be revisited in a later iteration without breaking the minimal API.

### 10.1 Observability — stay minimal; no `observability` prop

Observability is owned by the **runtime** layer, not infra. `@geekmidas/telescope`
already wraps handlers for request/exception monitoring (see
`packages/constructs/src/endpoints/AmazonApiGatewayEndpointAdaptor.ts`), and
`Function`/`Api` default to `logging: { format: 'json' }` so CloudWatch captures
structured logs. A construct-level log-shipping layer + env vars would duplicate
that concern and couple infra to a specific pipeline.

Iteration 1 ships **no** `observability` prop. A managed log-shipping pipeline,
if ever needed, can later be added as a single opt-in prop
(`observability?: { … }`) without changing the minimal default.

### 10.2 Node bundling — pure passthrough, no default `install` list

`nodejs` stays a typed passthrough to `sst.aws.Function`'s `nodejs` option
(`install`, `externals`). esbuild bundles by default; an `install` list is only
needed for native modules or deliberately-externalized deps, both app-specific.
A baked-in default would violate zero-config (surprising installs) for no general
benefit. Apps opt in per function.

### 10.3 Linkable depth — minimal bridge to the existing `ResourceType`

Wrap SST's native link types directly; reach for `Linkable` only where a
construct emits properties beyond what SST links natively. Concretely:

- `Function` and `Api` reuse the **existing** `ResourceType.Function` and
  `ResourceType.ApiGatewayV2` members — no new enum values, and the runtime
  `noop` processors already cover them.
- `Cron` is **not a link target** (nothing links *to* a cron), so it is not
  `Linkable` and introduces no `ResourceType.Cron`. It links *out* to its
  `processor`/`links` but exposes nothing linkable itself.

This corrects two earlier drafting errors, fixed below: §9's discriminator is
`ResourceType.ApiGatewayV2` (not `ResourceType.Api`), and §10 drops
`ResourceType.Cron`. A fuller per-construct linkable/validator model is deferred
until a construct actually needs to surface custom link properties.

### 10.4 Authorizers — `iam` / `none` only; custom authorizers deferred ✓

Confirmed. Iteration 1's `Route.authorizer` is `'iam' | 'none'`. Custom
Lambda/JWT authorizers are out of scope and can extend the union later without
breaking existing routes.

### 10.5 Docs location — design doc here; usage docs in `apps/docs` later ✓

Confirmed. This spec stays at `packages/cloud/docs/sst-constructs.md`.
User-facing usage documentation will be authored in `apps/docs` once the
constructs land.

---

## 12. Implementation phases

1. **Plumbing** ✓ — `./sst` export, explicit tsdown entries, and the tsconfig
   exclude; the cloud build still succeeds and ignores `src/sst`.
2. **Type-check fixture** ✓ — a minimal `sst.config.ts` + a `sst install`
   postinstall (in the private root `package.json`, so it never runs in
   consumers) generate `.sst/platform`, and `tsconfig.sst.json` +
   `pnpm --filter @geekmidas/cloud ts:check:sst` type-check `src/sst` against the
   real SST v4 globals (the gate filters out SST's platform-internal errors).
   `.sst/` is gitignored and biome-ignored.
3. **Foundation** — `App` (with Route53), `Stack`, `Linkable`.
4. **`Function`** — depended on by both `Cron` and `Api`.
5. **`Cron`** — smallest consumer of `Function`.
6. **`Api`** ✓ (first cut) — routes, per-route validation, least-privilege
   linking, native `ApiGatewayV2Args` passthrough.
7. **Docs/example** — usage snippets; user-facing docs in `apps/docs`.
</content>
