# The surface is the factory

**Status:** done. `e` is deleted, every caller builds from a surface, lint
passes and 3303 tests pass. The two suites that still fail need a database the
machine could not start — see the last section.

## The question that started it

`constructs/api.ts` carried two strings:

```ts
app: {
  envParser: './config/env#envParser',
  logger: './config/logger',
}
```

Why name a module path when you could hand over the actual logger and
environment parser?

## Why the strings existed

The build writes code. For every endpoint it generated a file containing a line
it had to compose as text:

```ts
import { envParser } from '../../config/env';   // written by the build
const adapter = new AmazonApiGatewayV2Endpoint(envParser, createUser);
```

A generator can print a module specifier. It cannot print an object — a live
`EnvironmentParser` does not know which file it came from. So the path had to be
written in config, which produced three bad things:

- The string is not typechecked. Rename the export and nothing says so until
  runtime.
- It is a duplicate. `endpoints/router.ts` already did `e.logger(logger)` with
  the real object, so the logger was named twice, in two forms, and nothing
  checked they agreed.
- We wrote a parser for the `#exportName` suffix.

## The answer

The generator does not need to write that import at all, if the endpoint is
built from the surface:

```ts
export const createUser = api.post('/users').handle(...)
```

`createUser` now holds a reference to `api`, and `api` holds the logger and the
parser. The generated file becomes:

```ts
import { createUser } from '../../endpoints/users.js';
const adapter = new AmazonApiGatewayV2Endpoint(createUser);
```

The adaptor reaches through `createUser.surface`. Nothing is printed, so nothing
has to be named.

## What the surface carries, and what it must not

The surface holds what the **process** is: logger, environment parser, CORS,
authorizers.

It must never hold `dependsOn`, `database`, `auditor` or `publisher`. Those four
inject a client into a handler, so putting one on the surface hands it to every
route the surface serves — a health check gets the database because a profile
endpoint needed it. This is the reasoning already written into
`RestApi.calls()`'s doc comment: spelling it `dependsOn` would invite the thing
least privilege forbids.

`auth` is excluded for a second reason: `.auth(construct)` already declares it,
and a second way to say the same thing is the duplication this model removes.

Shared grants go on a factory branched from `api.endpoints`, which a *group*
opts into:

```ts
export const router = api.endpoints
  .database(database)
  .auditor(AuditStorageService)
  .publisher(users.publisher);

export const listUsers = router.get('/users').dependsOn([sessions]).handle(...)
```

## What is built

1. **`Endpoint` carries a surface.** `EndpointSurface { id, envParser }`,
   threaded factory → builder → endpoint. `id` is also how the build attributes
   a route to the API that serves it, rather than inferring it by exclusion.

2. **`EndpointFactory` propagates it through all 13 clone sites.** The factory is
   immutable and each chainable method rebuilds it field by field, so a missed
   site would hand back a factory that had forgotten its surface and endpoints
   that had lost their parser.

3. **`RestApi` is a factory.** `api.get/post/put/patch/delete/options` for a
   single route, `api.endpoints` for a group. `readonly logger` and
   `readonly envParser` are always defined — the surface's own if given, the
   defaults otherwise.

4. **Adaptors resolve the parser from the endpoint.** `envParserFor(surface)` in
   `endpoints/surfaceEnv.ts`, defaulting to
   `new EnvironmentParser({ ...process.env, ...Credentials })` — which is what
   every application's `config/env.ts` was: boilerplate identical in every
   project, and mandatory, which is a poor combination.
   `new AmazonApiGatewayV2Endpoint(endpoint)` now takes one argument.

5. **Discovery records where each construct was declared.** `discover()` takes an
   optional `sources` out-parameter recording `{ file, exportName }`. The
   generated *server* entry needs a logger and parser for things that are not
   endpoint-scoped — CORS, queues, subscribers — so it imports the surface
   module by a path **derived from discovery** rather than one written in config.

## The migration

`e` is gone from both places it was exported — `endpoints/index.ts` and
`endpoints/EndpointFactory.ts`, which were two separate `new EndpointFactory()`
instances, so which one you got depended on your import path.

Every caller now builds from a surface. Three shapes came up:

- **A single route.** `api.get('/users')` — the surface's own sugar.
- **A group sharing something.** `api.endpoints.database(db).auditor(store)`,
  which is what `apps/example`'s router and kitchen-sink's became. The grant is
  opted into by the group rather than handed to every route on the surface.
- **A fixture that emits source as text.** The CLI's test helpers and `init`
  templates write endpoint files as strings, so the *string* had to grow a
  surface and an import, not the file doing the writing.

`gkm init` now scaffolds `src/constructs/api.ts` alongside the storage, email
and cache constructs it already wrote, and the scaffolded `router.ts` branches
from it instead of from `e`.

### The adaptors

`new AmazonApiGatewayV2Endpoint(envParser, endpoint)` became
`new AmazonApiGatewayV2Endpoint(endpoint)` at 124 call sites. The parser comes
from `endpoint.surface`, falling back to
`new EnvironmentParser({ ...process.env, ...Credentials })` — which is what
every application's `config/env.ts` was, so kitchen-sink deleted its own.

A trap worth knowing if any of this is revisited: the parameter was *removed*
rather than made optional, so an old two-argument call still compiles wherever a
spec builds its endpoint through `as any`. It fails at runtime inside
`wrappedHandler` with `Cannot read properties of undefined (reading 'child')` —
the adaptor reaching for `endpoint.logger` on what is really an
`EnvironmentParser`. Nothing in that message points at the constructor.

### Where the tests stand

3303 passing, 0 failing, across every project that does not need Postgres. Two
integration suites and one publisher suite could not run at all; see below.

## Open questions

- **A standalone endpoint still works** — `envParserFor(undefined)` returns the
  default parser — but there is no longer a factory to build one from. If that
  turns out to be wanted, it is a one-line export, not a redesign.
- **`telescope` and `studio` are still module-path strings** in `AppSpec`, with
  exactly the same shape and the same problem. The surface import added for the
  logger would carry them too.
- **`logContext`.** Per-request child loggers and `AsyncLocalStorage` context
  already exist, and `serviceContext.getLogger()` re-resolves per request. Two
  gaps: a handler cannot add bindings mid-request, and the extension hook
  (`getLoggerContext`) exists only on the APIGW adaptors, not on Hono and not at
  the surface. Declaring `logContext` beside `logger` on the surface is the
  natural home — it is a process fact, not a grant.

## How to verify what exists

```sh
cd apps/kitchen-sink && npx tsc --noEmit -p tsconfig.json
cd apps/api && gkm build --providers server,aws-apigatewayv2
```

Then read `apps/api/.gkm/aws-apigatewayv2/createUser.ts` — it should import the
endpoint and nothing else — and the head of `.gkm/server/app.ts`, which should
import the surface from a derived path.

## The local database

Two of the failing files need Postgres, and on the machine this was written on it
would not start: another project's container held host port 5432, so toolbox's
own Postgres never got its binding and connections landed on the wrong database —
which reports as `password authentication failed for user "geekmidas"` and reads
convincingly as bad credentials. It is not. Check `lsof -nP -iTCP:5432
-sTCP:LISTEN` before touching the volume.
