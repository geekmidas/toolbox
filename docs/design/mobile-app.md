# MobileApp: an Expo App as a Construct

- **Status:** Implemented (this PR). Device sign-in in tests and tunnels follow.
- **Impact:** Medium: a new construct and declaration kind, origin derivation
  in all three targets, the auth server requires Better Auth's Expo plugin.

## Why

A web app is a construct, so the graph knows who calls the API and the auth
server, and none of the following is written down: the site's API URL, the
API's CORS origins, the auth server's trusted origins. A mobile app was not a
construct, so all of it was hand-maintained, and some of it could not be done
at all. An app wired up by hand ends up with:

- **Its scheme hard-coded twice:** in `app.config.ts`, and in the auth server's
  `trustedOrigins`. A development build and the store build on one phone
  answer the same links.
- **Dev-only wildcards in `trustedOrigins`:** `exp://**`,
  `exp://192.168.*.*:*/**`, `http://192.168.*.*:*`. Every phone on the subnet
  is trusted because one is.
- **`expo()` added by hand** to the auth server.
- **A helper that rewrites magic links.** The auth server builds them on
  its `baseURL`, which a phone cannot open locally, so the app's links are
  rebuilt on the machine's LAN IP.
- **URLs in `eas.json`**, per profile, kept in step with the servers by hand.

The toolbox's own scaffold had the same gaps: the scheme in `app.config.ts`,
`localhost` URLs in `eas.json`, and an auth server that never learned the app
existed.

## Decisions

- **A construct, `MobileApp`, shaped like `StaticSite`.** The same config
  (`path`, `port?`, `config?`, `variant?`, here `'expo'`) plus `scheme?`, and
  the same `.dependsOn([api, auth])` as the single fact everything below is
  derived from. Not `.calls()`: a site and an app depend on surfaces.
- **One scheme, for every stage.** It is the project's name (`shop`), or the
  one the construct gives. A development build and the store build register
  the same scheme, and whichever stage's auth server a build talks to trusts
  it. Nothing about the app differs between stages but its URLs.
- **`app.config.ts` reads what `gkm` injects.** The scheme (`APP_SCHEME`) and
  the URLs (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_AUTH_URL`) are parsed with
  envkit into `extra.config`. The app reads `Constants.expoConfig.extra.config`
  at runtime. Nothing about a stage is written into the app.
- **The LAN address is found, never configured.** The app reads it from
  Expo's `hostUri` (the host the device loaded the bundle from), and uses it
  only when it is a private address. The local target reads the machine's
  network interfaces.
- **A mobile app gets each server's own port, not the edge's hostname.**
  `https://api-dev.shop.localhost` resolves only on this machine, and the
  edge (Caddy) routes by hostname, so no LAN address can stand in for it.
  `http://localhost:3000` can: the app swaps `localhost` for the host Metro
  served it from, which the device has already reached. A browser keeps the
  edge.
- **Exact origins, not wildcards.** On a local stage the trusted `exp://`
  origins are this machine's LAN address and `localhost`, on Metro's port. Not
  a subnet, and not any port.
- **Metro runs on the app's port.** A mobile app is given a port in the
  workspace's stable order, as a site is, or the one its `port` names.
  `gkm exec` hands it to Expo as `RCT_METRO_PORT`, which `expo start` uses when
  given no `--port`.
- **The app adds `expo()`; the auth server checks for it.** The construct
  knows a mobile app calls it, because the graph put a scheme among its derived
  origins, and refuses to start without the plugin (`ExpoPluginRequired`). It
  does not import `@better-auth/expo` itself: a package it imported would have
  to be its peer, and an optional peer gives every differently-resolving
  workspace package its own copy of `@geekmidas/constructs`. Then a construct
  from one copy is not an instance of the other, and the test harness finds
  none of the app's databases.

## Model

```ts
// constructs/app.ts
export const app = new MobileApp('App', { path: 'apps/app' })
  .dependsOn([api, auth]);
```

The declaration:

```
kind: 'mobile-app'
variant: 'expo'
app: { path: 'apps/app', port?, config? }
scheme?: string          // the base, when not the project's name
dependencies: [Api, Auth]
provides: ['APP_SCHEME']
```

`@geekmidas/manifest` states the shared rules once, because three targets ask
(the local one, Dokploy, AWS):

| Function | Answers |
|---|---|
| `schemeBase(project, given?)` | the scheme, on every stage: `shop`; `Corner Shop` → `corner-shop`; a leading digit gets `app` |
| `mobileOrigins(scheme, metro?)` | `shop://`, `shop://*`, and on a local stage `exp://<host>:<metro port>` (and `/**`) per host |
| `isWebOrigin(origin)` | what a cookie domain may be derived from: a scheme never is |

## What each target derives

### Local (`gkm dev`, `gkm test`, `gkm migrate`)

For `App` calling `Api` and `Auth`, on stage `dev`, with LAN address
`192.168.1.20` and the app on port 3003:

| Key | Value |
|---|---|
| `APP_SCHEME` | `shop` |
| `EXPO_PUBLIC_API_URL` | `http://localhost:3000` (the API's own port) |
| `EXPO_PUBLIC_AUTH_URL` | `http://localhost:3001` |
| `RCT_METRO_PORT` | `3003`, from `gkm exec`, in the app |
| `AUTH_TRUSTED_ORIGINS` | the web origins, then `shop://`, `shop://*`, `exp://192.168.1.20:3003`, `exp://192.168.1.20:3003/**`, `exp://localhost:3003`, `exp://localhost:3003/**` |
| `API_TRUSTED_ORIGINS` | the same, for the API |
| `AUTH_DEVICE_URL` | `http://192.168.1.20:3001`: the auth server on the LAN |

- **No network:** with no LAN address there is no `AUTH_DEVICE_URL`, and only
  `exp://localhost` is trusted. The simulator still works.
- **The cookie domain** is derived before the schemes are added: a scheme is
  not a host anything shares a cookie with.
- **Listening on the LAN:** the dev servers already do. `@hono/node-server`
  and `Bun.serve` listen on every interface when given no hostname.
- **A mobile app gets no compose service** and nothing behind the edge: Metro
  is reached by `exp://`, and a build ships through EAS.

### Deployed (Dokploy, AWS)

A surface a mobile app depends on trusts `shop://` and `shop://*`:
the bare scheme. No `exp://`, and no device URL. Neither target builds or
deploys the app. EAS and the stores do, so SST skips the declaration and
Dokploy has no provisioner for it.

## The auth server

`BetterAuth` already merges the derived origins with any its options add. With
a mobile caller it also:

1. **Requires `expo()` from `@better-auth/expo`** in the app's plugins when
   any *derived* trusted origin is not a web origin — the graph says a mobile
   app calls it. Without it, it refuses to start with `ExpoPluginRequired`,
   naming the scheme: the app would otherwise be refused on every request.
   It finds the plugin by its `id`, so it never imports the package. An
   origin the app adds by hand is not checked: a native client outside the
   graph may sign in another way.
2. **Builds an app's magic link on `AUTH_DEVICE_URL`** on a local stage. A
   link whose `callbackURL` is a scheme (`shop://…`) was asked for by
   the app, and will be opened on the phone. It is rebuilt on the device
   address, path and token kept. A link whose callback is a path or an
   `http(s)` URL was asked for by a browser, and is left alone. The magic-link
   plugin calls `sendMagicLink` through the options object it returns, so the
   construct wraps it there. The app's own `sendMagicLink` is unchanged.

### Signing in from the emailed link

The link is opened on the phone, in its browser — not in the app. The browser
calls `/magic-link/verify`, gets the session cookie, and is redirected to the
app's scheme. The app never had the cookie.

- **Server:** Better Auth's Expo plugin carries it on that redirect,
  `shop://…?cookie=<set-cookie>`, for a destination the server
  trusts. In 1.7 the check is `isTrustedOrigin`, so the wildcard `exp://`
  origins cover Expo Go too. Tested here for both.
- **App:** the Expo client stores a `?cookie=` itself only for a sign-in it
  opened (social, through `openAuthSessionAsync`). A link opened from mail
  arrives as a deep link it never sees, and that is not fixed as of 1.7.7. So
  the scaffold's `useSessionFromLink()`, called once from the root layout,
  reads it off the incoming link (`Linking.useLinkingURL`). It merges it into
  the Expo client's own store with the client's `getSetCookie`, keyed
  `<storagePrefix>_cookie`, and notifies `$sessionSignal`.
- **Merging matters.** `set-cookie` can carry more than one Better Auth cookie
  (the token and the cached session). A hand-written parser that keeps the
  first and writes over the store loses the rest.
- **No `Origin` override.** Requesting the link needs nothing extra either: the
  Expo client sends `expo-origin`, the server plugin turns it into the origin,
  and an undeclared scheme is refused. Tested with the origin check on, which
  Better Auth turns off under a test runner by default.

## The app

`gkm init --template fullstack` with Expo scaffolds:

- **`constructs/app.ts`:** the `MobileApp`, depending on the API and auth.
- **`constructs/auth.ts`:** `expo()` in the auth server's plugins, which the
  construct requires once the app depends on it.
- **`apps/app/app.config.ts`:** parses `APP_SCHEME`, `EXPO_PUBLIC_API_URL` and
  `EXPO_PUBLIC_AUTH_URL` into `extra.config`. The scheme, and the bundle id and
  Android package built on it, come from there.
- **`apps/app/config.ts`:** reads `extra.config` and points `localhost` at a
  host the device reaches, in this order:
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
   app  shop:// — devices reach 192.168.1.20
```

## Not in this design yet

- **`device.signIn()` in the test harness.** A `device` next to `browser`,
  holding the session as Better Auth's Expo client does (a bearer cookie in
  secure storage) rather than a cookie jar. This is how device login gets
  tested.
- **`expo start --tunnel`.** A tunnel forwards only Metro's port, so the
  servers would have to be reached through Metro, by proxying their paths
  (`/__api`, `/__auth`). LAN only for now.
- **Building the store app from the graph.** EAS builds outside `gkm`, so
  `eas.json` still carries the deployed URLs. A `gkm build` for a mobile app
  could resolve them from the deployed stage.
