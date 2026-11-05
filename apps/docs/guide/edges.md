# Edges and Environment

`.dependsOn([...])` declares an **edge** from a caller to a target. The edges
are what decide which environment variables each process gets. Nothing is
handed out because the workspace happens to resolve it: a key reaches a
process only if the process declares it, or has an edge to the construct that
provides it, or is called by a client whose identity it needs.

There is one rule, and every command applies it the same way:

| Command | Where the keys go |
| --- | --- |
| `gkm dev`, `gkm exec` | the app's process |
| `gkm compose` (any stage) | the app's env file, `.gkm/compose/<stage>/<app>.env` |
| `gkm docker` | the app's service in the apps profile |

So a key that is missing from a deployed env file is missing under `gkm dev`
too. Code that reads it fails on its first local request, not in production.

The rule lives in `appEnvKeys` and `callerKeys` (in
`packages/cli/src/reconcile/apps.ts`). A change to either one goes with a
change to this page.

## Naming

Every key is named after the construct it describes, using its id
(`provideKey`): `Api` → `API_URL`, `AdminApp` → `ADMIN_APP_SCHEME`,
`Orders` → `ORDERS_URL`. Below, `<T>` is the target's id and `<C>` is the
caller's.

`<ID>_URL` is the public address, the one a browser or a phone opens. There is
no separate internal URL. A sibling on the same stack calls the public
address too, through the edge.

## What each side of an edge gets

`caller.dependsOn([target])`:

| Target kind | The caller gets | The target gets |
| --- | --- | --- |
| `RestApi` (an auth server included) | `<T>_URL` | from a `MobileApp` caller: `<C>_SCHEME`<br>from a site caller: `<C>_URL` |
| `WebSocketApi` | `<T>_URL`; a server process also gets `<T>_PUBLISHER_CONNECTION_STRING` | same as a `RestApi` |
| `Queue`, `Topic` | its keys, and `EVENT_PUBLISHER_CONNECTION_STRING` | nothing |
| `ObjectStorage` | its keys (`<T>_CONNECTION_STRING`, `<T>_SIGNED_ORIGIN`), the `<F>_URL` of each file server over it, and `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | nothing |
| `FileServer` | from a server process: its bucket's keys, as for `ObjectStorage`, and its own `<T>_URL`<br>from a `StaticSite` or `MobileApp`: `<T>_URL` and its bucket's `<B>_SIGNED_ORIGIN` only, no connection and no credentials; through `.dependsOn([assets.server])`, the bucket's keys too | nothing |
| `Inbox` | its keys (and, locally, the token Mailpit relays mail with) | nothing |
| a database, schema, reader, cache, secret, credential, external API, mail, encryption, `Telemetry` | its keys | nothing |

Some notes on the table:

- **A surface hands its caller its address, and nothing else.** `AUTH_URL`
  goes to the API. The auth server's secret, database and mailer stay with the
  auth server. A surface's `<T>_TRUSTED_ORIGINS` and `<T>_COOKIE_DOMAIN` are
  its own settings, and only its own process reads them.
- **A frontend's plain edge to a file server is to its public face.** A
  site or a mobile app that depends on `assets` gets the address its objects
  are served on, and nothing that writes to the bucket: its `assets` client
  serves (`url()`, `openUrl()`, `processedUrl()`), and a bucket method throws
  `FileServerReadOnly`. A full-stack site whose server half uploads or
  presigns asks for the bucket by name, `.dependsOn([assets.server])`. A
  backend's plain edge is to the bucket already, so it never needs `.server`.
- **The edge is one hop.** An app that calls the API gets `API_URL`, not the
  API's database.
- **`.auth(auth)` is an edge** to the auth server, just like `.dependsOn([auth])`.

## The caller's identity, back to the target

When a client calls a surface, the surface gets the client's own key. With
it, the surface can build links and redirects back into the client:

```ts
export const api = new RestApi('Api', { path: 'apps/api' /* … */ });
export const web = new StaticSite('Web', { path: 'apps/web' }).dependsOn([api]);
export const app = new MobileApp('App', { path: 'apps/app' }).dependsOn([api]);
```

| | `API_URL` | `APP_SCHEME` | `WEB_URL` |
| --- | --- | --- | --- |
| `api` | ✓ (its own) | ✓ | ✓ |
| `web` | ✓ (`VITE_API_URL` too) | | ✓ (its own) |
| `app` | ✓ (`EXPO_PUBLIC_API_URL` too) | ✓ (its own) | |

For example, an API that sends a phone back into the app after an OAuth
callback can read the scheme from the environment, on every stage:

```ts
const { scheme } = envParser
  .create((get) => ({ scheme: get('APP_SCHEME').string() }))
  .parse();
// → redirect to `${scheme}://auth/callback?status=ok`
```

Each key carries the caller's id, so two apps calling one API don't collide:
they arrive as `APP_SCHEME` and `ADMIN_APP_SCHEME`.

Only **clients** pass their identity back: a site (its URL) and a mobile app
(its scheme). A surface, a worker or a function that calls a surface is
something the surface answers, never somewhere it sends a user. So nothing of
theirs comes back along the edge. Their origins still reach the target, inside
its `<T>_TRUSTED_ORIGINS`.

## Origins and the cookie domain

The same inbound edges set two of the surface's own values:

- **`<T>_TRUSTED_ORIGINS`** lists the public origin of every caller with an
  address. A mobile caller is listed as its scheme (`shop://`, `shop://*`).
  Locally, the `exp://` hosts Expo Go sends from are listed too. A surface
  never lists itself.
- **`<T>_COOKIE_DOMAIN`** is the parent domain that the surface and its web
  callers share (`.example.com`), so a session set by the auth server is seen
  by the site and the APIs.

## What a bundle inlines

A site or a mobile app is a bundle. A value it reads is inlined when it is
built, under the prefix its bundler inlines (`publicEnvFor`):

| Variant | Prefix |
| --- | --- |
| `static`, `tanstack` (Vite) | `VITE_` |
| `next` | `NEXT_PUBLIC_` |
| `expo` | `EXPO_PUBLIC_` |

Only public values get the prefix: a surface's or a WebSocket surface's
`<T>_URL`, a file server's `<T>_URL` (`VITE_ASSETS_URL` for
`FileServer('Assets')`, on either edge), a bucket's `<T>_SIGNED_ORIGIN`,
`GKM_IMAGE_ORIGINS`, the local mail inbox's address, and the
site's own `<C>_URL` (with `<C>_DOMAIN` and `<C>_PROTECTED_SUBDOMAINS` for a
site on every subdomain). A connection string (a bucket's
`<T>_CONNECTION_STRING` included, even through `.server`) or a
secret is never prefixed into a bundle, even when the site has an edge to it.
A site's server half (Next, TanStack Start) reads the unprefixed keys at
runtime, as a backend does.

A bundle never gets a `Telemetry` node's keys. The exporter belongs to the
server.

## Beyond the edges

Every process also gets:

- **the stage's own keys**: every key set with `gkm secrets:set` that no
  construct provides (`STRIPE_KEY`, read with `get('STRIPE_KEY')`), except
  the ones gkm keeps for the stack itself (a container's login, the server's
  address);
- **`GKM_EDGE_TOKEN`**, which a call to a sibling through the edge carries;
- `PORT`, `STAGE` and `NODE_ENV`.

A **Worker**'s process gets the edges of everything built from it: each cron,
queue consumer and subscriber. It also gets `EVENT_PUBLISHER_CONNECTION_STRING`,
the broker its crons schedule through. Under `gkm dev`, an API's process also
runs the workers whose code it holds, so it gets their keys as well. On a
stack, each worker runs in a container of its own with its own env file.

`gkm test` is the one command that hands every key the stage resolves to its
one process. A `featureTest` runs the API's handler, the queue consumer and
the subscribers in the same process. `gkm dev` is where a missing edge shows
up.

## Checking a stage before a release

`gkm compose --dry-run` writes every env file for the stage and starts
nothing:

```bash
gkm compose --stage production --dry-run
cat .gkm/compose/production/api.env
```

The file holds exactly the keys the API will get on that stage. These are
the same keys `gkm dev` hands it locally.

::: info The SST target
On AWS, each Lambda is linked only to what its own endpoint, cron or consumer
depends on (`resolveEdges`). The surface's trusted origins come from the same
inbound edges. The caller's identity (`APP_SCHEME`, `WEB_URL`) is not linked
to a surface's Lambdas yet.
:::
