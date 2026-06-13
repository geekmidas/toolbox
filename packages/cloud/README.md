# @geekmidas/cloud

SST (ion / Pulumi) integration for `@geekmidas` apps — opinionated, linkable
constructs that map 1:1 to deployable units and **validate their environment
before deploy**, plus the runtime helpers that resolve linked resources into
environment variables.

Two halves:

- **`@geekmidas/cloud/sst`** — the **infra-time** constructs you instantiate in
  `sst.config.ts` (`App`, `Stack`, `Function`, `Api`, `Cron`).
- **`@geekmidas/cloud` / `@geekmidas/cloud/utils`** — the **runtime** helpers
  (`buildResourceEnv`, `ResourceType`) that turn SST `Resource` links into flat
  environment variables inside a Lambda.

> Design notes and rationale live in [`docs/sst-constructs.md`](./docs/sst-constructs.md)
> (constructs) and [`docs/sst-testing.md`](./docs/sst-testing.md) (testing).

## Install

```bash
pnpm add @geekmidas/cloud
```

`./sst` targets **SST v4** (peer dependency `sst@^4`) and is distributed as raw
TypeScript source — it extends the ambient `sst.aws.*` globals that only exist
after `sst install` in your app.

## `@geekmidas/cloud/sst`

```ts
import { App, Api, Function, Cron } from '@geekmidas/cloud/sst';
```

### App & Stack

`App` is a plain synchronous construct; resolve the hosted zone once at the call
site and pass it in. `app.stack(name)` creates a `Stack` bound to the app.

```ts
const { zoneId } = await aws.route53.getZone({ name: 'example.com' });

const app = new App({
  name: 'my-app',
  stage: 'prod',
  domain: 'example.com',
  hostedZoneId: zoneId,
  region: 'us-east-1',
});

const stack = app.stack('api');
stack.logicalPrefixedName('handler'); // "prod-my-app-api-handler"
stack.select({ prod: 'live', default: 'dev' }); // by-stage value with a default
```

### Function

Extends `sst.aws.FunctionArgs` (native options pass through), merges standard
env defaults, defaults to `nodejs24.x` + JSON logging, and **validates `envVars`
against `links` at synth time** — attaching only the links a function needs
(least privilege).

```ts
const fn = new Function(stack, 'Processor', {
  handler: 'src/processor.handler',
  links: [db, topic],
  envVars: ['DATABASE_URL'], // validated against links; fails synth if missing
});
```

### Api

Extends `sst.aws.ApiGatewayV2Args` (CORS/domain/etc. pass through). Routes are a
typed table with per-route env validation, least-privilege linking, and a typed
authorizer model.

```ts
const api = new Api(stack, 'Api', {
  links: [db],
  authorizers: {
    jwt:      { issuer: 'https://issuer', audiences: ['aud'] }, // 'jwt' → JWT settings
    employee: { handler: 'src/employee-auth.handler' },         // custom → Lambda authorizer
  },
  routes: [
    { method: 'GET',  path: '/me',  handler: 'me.handler',  authorizer: 'jwt' },
    { method: 'GET',  path: '/adm', handler: 'adm.handler', authorizer: 'employee' },
    { method: 'POST', path: '/pub', handler: 'pub.handler' }, // public (none)
  ],
});
```

A route's `authorizer` is type-constrained to `'iam' | 'none'` plus the declared
authorizer names — an undeclared name is a compile error, and `jwt` requires JWT
settings while custom authorizers require a `handler`.

### Cron

Wraps `sst.aws.CronV2` (`sst.aws.Cron` is deprecated). `processor` is a
`Function` (or anything with an `arn`); `schedule` is a typed `rate(…)` /
`cron(…)` / `at(…)`.

```ts
const cron = new Cron(stack, 'Nightly', { processor: fn, schedule: 'rate(1 day)' });
```

### From a `gkm build` manifest

`gkm build` emits a deployment manifest (types in `@geekmidas/manifest`). Each
construct has a static `fromManifest` factory that maps it straight into infra:

```ts
import routes from './.gkm/routes-manifest.json';

const api     = Api.fromManifest(stack, 'Api', routes, { links: [db], authorizers });
const workers = Function.fromManifest(stack, functionsManifest, { links: [db] });
const crons   = Cron.fromManifest(stack, cronsManifest, { links: [db] });
```

## `@geekmidas/cloud/utils` (runtime)

```ts
import { buildResourceEnv } from '@geekmidas/cloud';
```

`buildResourceEnv` turns a record of SST `Resource` links into flat environment
variables at runtime, using the shared `ResourceType` vocabulary.
