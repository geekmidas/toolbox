# MobileApp: an Expo App as a Construct

- **Status:** Implemented (this PR). Device sign-in in tests and tunnels follow.
- **Impact:** Medium: a new construct and declaration kind, origin derivation
  in all three targets, the auth server pairs Better Auth's Expo plugin.
- **First user:** beetlefit (`apps/app`)

## Why

A web app is a construct, so the graph knows who calls the API and the auth
server, and none of the following is written down: the site's API URL, the
API's CORS origins, the auth server's trusted origins. A mobile app was not a
construct, so all of it was hand-maintained, and some of it could not be done
at all. carsharenova's auth server shows the cost:

- **Its scheme hard-coded twice:** in `app.config.ts`, and in the auth server's
  `trustedOrigins` (`'com.technanimals.carsharenova://'`). A development build
  and the store build on one phone answer the same links.
- **Dev-only wildcards in `trustedOrigins`:** `exp://**`,
  `exp://192.168.*.*:*/**`, `http://192.168.*.*:*`. Every phone on the subnet
  is trusted because one is.
- **`expo()` added by hand** to the auth server.
- **A `normalizeMagicLinkUrl` helper.** The auth server builds magic links on
  its `baseURL`, which a phone cannot open locally, so the app's links are
  rebuilt on the machine's LAN IP.
- **URLs in `eas.json`**, per profile, kept in step with the servers by hand.

The toolbox's own scaffold had the same gaps: the scheme in `app.config.ts`,
`localhost` URLs in `eas.json`, and an auth server that never learned the app
existed.

## Decisions

- **A construct, `MobileApp`, with Expo as its flavour.** Like `StaticSite`,
  its `.dependsOn([api, auth])` is the single fact everything below is derived
  from. Not `.calls()`: a site and an app depend on surfaces.
- **The scheme is derived, per stage.** The base is the project's name
  (`beetlefit`), or the one the construct gives. A local or test stage
  suffixes it (`beetlefit-dev`), so a development build and the store build on
  one phone never answer each other's links. A deployed stage uses the base:
  what the store build registers.
- **`app.config.ts` reads what `gkm` injects.** The scheme (`APP_SCHEME`) and
  the URLs (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_AUTH_URL`) are parsed with
  envkit into `extra.config`. The app reads `Constants.expoConfig.extra.config`
  at runtime. Nothing about a stage is written into the app.
- **The LAN address is found, never configured.** The app reads it from
  Expo's `hostUri` (the host the device loaded the bundle from), and uses it
  only when it is a private address. The local
  target reads the machine's network interfaces.
- **A mobile app gets each server's own port, not the edge's hostname.**
  `https://api-dev.beetlefit.localhost` resolves only on this machine, and the
  edge (Caddy) routes by hostname, so no LAN address can stand in for it.
  `http://localhost:3000` can: the app swaps `localhost` for the host Metro
  served it from, which the device has already reached. A browser keeps the
  edge.
- **Exact origins, not wildcards.** On a local stage the trusted `exp://`
  origins are this machine's LAN address and `localhost`, with any port. Not a
  subnet.
- **The auth server pairs `expo()` itself** when a scheme is among its trusted
  origins, the way it already derives everything else from its callers.

## Model

```ts
// constructs/app.ts
export const app = new MobileApp('App', { path: 'apps/app' })
  .dependsOn([api, auth]);
```

The declaration:

```
kind: 'mobile-app'
flavour: 'expo'
app: { path: 'apps/app' }
scheme?: string          // the base, when not the project's name
dependencies: [Api, Auth]
provides: ['APP_SCHEME']
```

`@geekmidas/manifest` states the shared rules once, because three targets ask
(the local one, Dokploy, AWS):

| Function | Answers |
|---|---|
| `schemeBase(project, given?)` | `beetlefit`; `Beetle Fit` → `beetle-fit`; a leading digit gets `app` |
| `appScheme(base, localStage?)` | `beetlefit-dev` locally, `beetlefit` deployed |
| `mobileOrigins(scheme, metro?)` | `beetlefit://`, `beetlefit://*`, and on a local stage `exp://<host>:*` (and `/**`) per host |
| `isWebOrigin(origin)` | what a cookie domain may be derived from: a scheme never is |

## What each target derives

### Local (`gkm dev`, `gkm test`, `gkm migrate`)

For `App` calling `Api` and `Auth`, on stage `dev`, with LAN address
`192.168.1.20`:

| Key | Value |
|---|---|
| `APP_SCHEME` | `beetlefit-dev` |
| `EXPO_PUBLIC_API_URL` | `http://localhost:3000` (the API's own port) |
| `EXPO_PUBLIC_AUTH_URL` | `http://localhost:3001` |
| `AUTH_TRUSTED_ORIGINS` | the web origins, then `beetlefit-dev://`, `beetlefit-dev://*`, `exp://192.168.1.20:*`, `exp://192.168.1.20:*/**`, `exp://localhost:*`, `exp://localhost:*/**` |
| `API_TRUSTED_ORIGINS` | the same, for the API |
| `AUTH_DEVICE_URL` | `http://192.168.1.20:3001`: the auth server on the LAN |

- **No network:** with no LAN address there is no `AUTH_DEVICE_URL`, and only
  `exp://localhost` is trusted. The simulator still works.
- **The cookie domain** is derived before the schemes are added: a scheme is
  not a host anything shares a cookie with.
- **Listening on the LAN:** the dev servers already do. `@hono/node-server`
  and `Bun.serve` listen on every interface when given no hostname.
- **Ports:** a mobile app is given none of the `30xx` ports. Metro picks its
  own, and the `exp://` origins trust any port on an exact host.

### Deployed (Dokploy, AWS)

A surface a mobile app depends on trusts `beetlefit://` and `beetlefit://*`:
the bare scheme. No `exp://`, and no device URL. Neither target builds or
deploys the app. EAS and the stores do, so SST skips the declaration and
Dokploy has no provisioner for it.

## The auth server

`BetterAuth` already merges the derived origins with any its options add. With
a mobile caller it also:

1. **Adds `expo()` from `@better-auth/expo`** when any trusted origin is not a
   web origin, unless the app's options already include it. The package is an
   optional peer dependency of `@geekmidas/constructs`, loaded only then.
   Without it, `ExpoPluginMissing` says what to install.
2. **Builds an app's magic link on `AUTH_DEVICE_URL`** on a local stage. A
   link whose `callbackURL` is a scheme (`beetlefit-dev://…`) was asked for by
   the app, and will be opened on the phone. It is rebuilt on the device
   address, path and token kept. A link whose callback is a path or an
   `http(s)` URL was asked for by a browser, and is left alone. The magic-link
   plugin calls `sendMagicLink` through the options object it returns, so the
   construct wraps it there. The app's own `sendMagicLink` is unchanged.

## The app

`gkm init --template fullstack` with Expo scaffolds:

- **`constructs/app.ts`:** the `MobileApp`, depending on the API and auth.
- **`apps/app/app.config.ts`:** parses `APP_SCHEME`, `EXPO_PUBLIC_API_URL` and
  `EXPO_PUBLIC_AUTH_URL` into `extra.config`. The scheme, and the bundle id and
  Android package built on it, come from there.
- **`apps/app/config.ts`:** reads `extra.config` and points `localhost` at a
  host the device reaches, in the order carsharenova's `src/config.ts` settled
  on:
  - **Metro's host, when it is a private LAN address:** a phone on the same
    Wi-Fi.
  - **`10.0.2.2` on the Android emulator** (`Platform.OS === 'android'` and
    not `Device.isDevice`), whose own `localhost` is the emulator itself. This
    matters when Metro runs with `--localhost`.
  - **Otherwise, unchanged:** the iOS simulator shares the machine's
    `localhost`. A tunnel's `*.exp.direct` host is never used, because a tunnel
    forwards only Metro, not the servers.
  Deployed URLs have no `localhost` in them and pass through untouched.
- **The auth client:** takes its scheme and storage prefix from that config.
- **`eas.json`:** a store build is told the bare `APP_SCHEME`, since EAS builds
  outside `gkm`. The development profile carries nothing `gkm` injects.
- **The root `package.json`:** `@better-auth/expo`, for the auth server.

`gkm dev` lists the app with its scheme and the address devices reach:

```
   app  beetlefit-dev:// — devices reach 192.168.1.20
```

## Not in this design yet

- **`device.signIn()` in the test harness.** A `device` next to `browser`,
  holding the session as Better Auth's Expo client does (a bearer cookie in
  secure storage) rather than a cookie jar. This is how device login gets
  tested.
- **`expo start --tunnel`.** A tunnel forwards only Metro's port, so the
  servers would have to be reached through Metro (carsharenova proxies
  `/__api` and `/__auth`). LAN only for now.
- **Building the store app from the graph.** EAS builds outside `gkm`, so
  `eas.json` still carries the deployed URLs. A `gkm build` for a mobile app
  could resolve them from the deployed stage.
