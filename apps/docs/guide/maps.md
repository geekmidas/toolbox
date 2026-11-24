# Maps

`Maps` declares that the app calls Google Maps — the map itself, places,
geocoding, routes — and the graph decides who holds which key.

```ts
// constructs/maps.ts
import { Maps } from '@geekmidas/constructs/maps';

export const maps = new Maps('Maps', {
  apis: ['maps', 'places', 'geocoding'],
});
```

`apis` is what the app calls: `maps` (the map, drawn in a page or a phone),
`static-maps`, `places`, `geocoding` and `routes`. Every key is restricted to
these and nothing else.

## A key per caller

Depend on it from whatever calls Maps. Every caller gets a key of its own,
and reads it under the role's name:

| Caller | Reads | Its key is restricted to |
|---|---|---|
| a server process — an API, a worker, a function no worker runs | `MAPS_API_KEY`, as `services.maps.apiKey` | the declared web services, and the stage's server address where it runs on one |
| a site | `MAPS_BROWSER_KEY`, inlined as `VITE_`/`NEXT_PUBLIC_MAPS_BROWSER_KEY` | the APIs, and that site's host as referrer |
| a mobile app | `MAPS_ANDROID_KEY` and `MAPS_IOS_KEY`, inlined as `EXPO_PUBLIC_…` | the APIs, and that app's Android package and signing certificates, or its iOS bundle id |

Two sites that call Maps get two browser keys, each allowed only from its own
host; two apps, two Android keys. The code is the same in each — it reads
`MAPS_BROWSER_KEY` — and on a deployed stage the value is its own: the stage
keeps each caller's apart as `MAPS_BROWSER_KEY_WEB`, `MAPS_BROWSER_KEY_ADMIN`,
and hands each process only its own, under the role's name. A key that leaks
from one app works for no other, each is rotated alone, and Cloud Console
shows each one's use — named `Maps/Web browser production`.

```ts
// a server process
export const geocode = router
  .get('/geocode')
  .dependsOn([maps])
  .handle(({ services }) => services.maps.geocode(address));

// a site and a phone
new Site('Web', { path: 'apps/web' }).dependsOn([api, maps]);
new MobileApp('App', {
  path: 'apps/app',
  android: { package: 'com.acme.shop' },
  ios: { bundleIdentifier: 'com.acme.shop' },
}).dependsOn([api, maps]);
```

Nobody writes down who holds a key: it is read off the edges. Each caller is
handed only its own key, so a site's bundle never holds the server's key, and
the key in a page's JavaScript is refused from another site's page or a phone.

## On the server

A server process that depends on a `Maps` is handed a client, not a string.
It has a method for each web service the construct declares, and nothing else,
so a call the key is not restricted to does not build:

```ts
export const maps = new Maps('Maps', { apis: ['geocoding', 'places', 'routes'] });

.handle(async ({ services }) => {
  const [home] = await services.maps.geocode('1 Main Rd, Woodstock');
  const cafes = await services.maps.searchPlaces('coffee near Woodstock');
  const [route] = await services.maps.computeRoutes({
    origin: home.location,
    destination: { placeId: cafes[0].id },
    travelMode: 'WALK',
  });
  // services.maps.staticMapUrl(...) does not exist: 'static-maps' is not declared.
});
```

| `apis` | Methods |
|---|---|
| `geocoding` | `geocode(address, { region?, language? })`, `reverseGeocode({ lat, lng })` |
| `places` | `searchPlaces(text, { fields?, maxResultCount? })`, `placeDetails(id, { fields? })` (Places API (New)) |
| `routes` | `computeRoutes({ origin, destination, travelMode?, fields? })` (Routes API) |
| `static-maps` | `staticMapUrl({ center, zoom, size, markers? })`: a URL carrying the server key, for markup the server sends |
| `maps` | nothing: the map is drawn by a page or a phone |

Places and Routes bill by the fields they answer, so each takes a `fields`
mask, with a small default. A refused call throws `MapsRequestFailed`, with
the API, the HTTP status and Google's own status and message. Each call is
traced as a span named after the construct (`Maps.geocode`), like an
`ExternalApi`'s. `apiKey` is still on the client for anything it does not
cover.

## On a phone

`react-native-maps` reads its keys from native config (the Android manifest
and the iOS plist), not from JavaScript. The construct's config plugin puts
the `EXPO_PUBLIC_` keys the app is handed there:

```ts
// apps/app/app.config.ts
plugins: ['@geekmidas/constructs/maps/expo'],
// a construct with another name:
plugins: [['@geekmidas/constructs/maps/expo', { maps: 'Places' }]],
```

`gkm eas:sync`, and so `gkm publish`, refuses with `MapsKeysNotInNativeConfig`
an app that depends on a `Maps` and never hands the keys over, since its store
build would ship a map that never loads.

## Locally

Maps has no local emulator, so it is the one provider kind the local stage
may name. Point the local stage at a Google Cloud project of its own — not a
deployed stage's — and `gkm provision` creates its keys:

```ts
// gkm.config.ts
deploy: {
  maps: {
    development: { provider: 'google', project: 'shop-dev' },
    production: { provider: 'google' },
  },
}
```

```bash
gkm provision --stage development
```

Each caller gets its own key, restricted from the local stage's own facts:
a site's browser key to its host on the local edge (`https://shop.localhost/*`),
a server key to its APIs alone — a laptop has no fixed address. `gkm dev` and
`gkm test` hand each app its own key under the role's name
(`MAPS_BROWSER_KEY_WEB` arrives as `MAPS_BROWSER_KEY`). They are written into the
local stage's secrets and recorded in this machine's state, so each developer
provisions their own and a second run makes nothing.

Without `deploy.maps.<local>`, the local stage's keys are set by hand, as a
credential's are — one per role, read by every caller of it:

```bash
gkm secrets:set MAPS_API_KEY AIza… --stage development
gkm secrets:set MAPS_BROWSER_KEY AIza… --stage development
```

## In tests

`gkm test` needs no key and calls nothing. The test stage hands the client a
fake key, and Google's Maps hosts are answered in-process by a built-in fake.
Its answers are deterministic: the same address is always the same point, and
a route is as long as the distance between its ends.

For other answers, default-export a fake from `test/fakes/<id>.ts`, falling
through to the built-in one for the rest:

```ts
// test/fakes/maps.ts
import { defaultMapsHandler, mapsFake } from '@geekmidas/constructs/maps/fake';

export default mapsFake({
  async fetch(request) {
    const url = new URL(request.url);
    if (url.searchParams.get('address') === 'nowhere') {
      return Response.json({ status: 'ZERO_RESULTS', results: [] });
    }
    return defaultMapsHandler.fetch(request);
  },
});
```

`gkm dev --fake` does not fake Maps: a local process calls Google with the
local stage's key.

## Deployed: `deploy.maps.<stage>`

```ts
// gkm.config.ts
deploy: {
  maps: {
    production: {
      provider: 'google',
      project: 'shop-maps',
      android: { sha1: ['AB:CD:…'] },
    },
  },
},
```

| Value | Meaning |
|---|---|
| `'external'` (or nothing) | The keys are set in the stage's secrets by you: one per role (`MAPS_BROWSER_KEY`), read by every caller of it, or a caller's own (`MAPS_BROWSER_KEY_WEB`). |
| `{ provider: 'google', project?, android? }` | Every deploy makes the keys in a Google Cloud project, and writes them into the stage's secrets. |
| `false` | The stage has no maps. A deploy of a workspace that declares a `Maps` is refused with `StageProviderDisabled`. |

The `google` provider, on every deploy:

1. **The project.** `--project`, else `project`, else `<workspace>-<stage>`,
   created when it is not there. The first deploy records it; a later one
   that resolves another stops with `GoogleProjectChanged`.
2. **The APIs.** The services the keys call are turned on, with the API Keys
   and Cloud Billing APIs the provider itself uses.
3. **Billing.** Maps serves no project without a billing account. Without one
   the deploy stops with `MapsBillingDisabled` and the link to link one. gkm
   never links billing itself.
4. **The keys.** One per caller the graph has, each restricted to that
   caller as above and written into the stage's secrets as its own
   (`MAPS_BROWSER_KEY_WEB`). Restrictions follow the graph on every deploy:
   add an API to `apis`, and every key is allowed it — the keys stay the
   same. A new caller gets a new key.

**Android** keys are restricted by package *and* signing certificate. The
package is the `MobileApp`'s `android.package`. The certificates are each
keystore EAS signs the app's builds with — read from EAS by the app's
`eas.projectId` when `EXPO_TOKEN` is set — and `android.sha1`: Play's app
signing certificate, from Play Console → Test and release → App integrity →
*App signing key certificate*. Play re-signs what it installs, so a stage
that ships the app through Google Play (`deploy.mobile.<stage>` is
`google-play`) needs Play's; any other stage needs one or the other. With
none, the deploy stops with `MapsAndroidKeyUnsigned` rather than make a key
anyone who unpacks the app could use. **iOS** keys are restricted to the
`MobileApp`'s `ios.bundleIdentifier`. A platform the `MobileApp` does not
declare gets no key, and the app reads none.

**A server key** is restricted to the stage's server where it runs on one:
a compose stage's `GKM_SERVER_IPV4`, and `GKM_SERVER_IPV6` where it has one.
A stage with no fixed outbound address — functions on AWS — restricts it to
its APIs alone, and the deploy says so: keep it on the server.

**A browser key** needs a host to be restricted to: a site on a stage with no
domain stops the deploy with `MapsSiteHasNoHost`, since a browser key
restricted to no referrer is anyone's.

**A server caller of the map alone** — `apis: ['maps']` and an edge from an
endpoint — stops with `MapsServerKeyCallsNothing`: the map is drawn in a page
or a phone, and a server key has nothing to call.

**A key you set wins.** A key the stage's secrets already hold, that the
provider did not make, is used as it is and nothing is made for it: a
caller's own, or one per role, read by every caller that has none of its
own.

`--rotate-keys` makes each key a successor; the old one is deleted by the
first deploy after the stage has run with the new one, or at once with
`--retire-old-keys` (see [Rotating a key](./providers.md#rotating-a-key)).
A key nothing holds any more — a caller that dropped its edge, or the one
key per kind of caller an earlier version made — is retired the same way:
kept until the stage has run without it, then deleted from Google, the
state and the stage's secrets.

Every deploy checks each caller's key is in the stage's secrets, and stops
with `MapsNotProvisioned`, naming the ones that are not.

See [Credentials → Google](./providers.md#google) for how the deploy signs in
to Google, locally and in CI.
