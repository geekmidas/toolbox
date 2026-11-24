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

## A key per kind of caller

Depend on it from whatever calls Maps. Each kind of caller gets its own key:

| Caller | Key | Restricted to |
|---|---|---|
| a server process — an endpoint, a function, a cron, a subscriber | `MAPS_API_KEY`, as `services.maps.apiKey` | the declared web services |
| a site | `MAPS_BROWSER_KEY`, inlined as `VITE_`/`NEXT_PUBLIC_MAPS_BROWSER_KEY` | the APIs, and the stage's calling sites' hosts as referrers |
| a mobile app | `MAPS_ANDROID_KEY` and `MAPS_IOS_KEY`, inlined as `EXPO_PUBLIC_…` | the APIs, and the app's Android package and signing certificates, or its iOS bundle id |

```ts
// a server process
export const geocode = router
  .get('/geocode')
  .dependsOn([maps])
  .handle(({ services }) => lookUp(address, services.maps.apiKey));

// a site and a phone
new Site('Web', { path: 'apps/web' }).dependsOn([api, maps]);
new MobileApp('App', { path: 'apps/app' }).dependsOn([api, maps]);
```

Nobody writes down who holds a key: it is read off the edges. Each caller is
handed only its own key, so a site's bundle never holds the server's key, and
the key in a page's JavaScript is refused from another site's page or a phone.
A server's key is restricted by its APIs alone: keep it on the server.

An Expo app hands its keys to the native map in `app.config.ts`:

```ts
export default {
  android: { config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_MAPS_ANDROID_KEY } } },
  ios: { config: { googleMapsApiKey: process.env.EXPO_PUBLIC_MAPS_IOS_KEY } },
};
```

## Locally

The local stage's keys are set by hand, as a credential's are — a key from
your own Google Cloud project, unrestricted or restricted to `localhost`:

```bash
gkm secrets:set MAPS_API_KEY AIza… --stage development
gkm secrets:set MAPS_BROWSER_KEY AIza… --stage development
```

In tests, answer the Maps web services through MSW: the key is only a string
in the request.

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
| `'external'` (or nothing) | Each key is set in the stage's secrets by you. |
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
4. **The keys.** One per kind of caller the graph has, each restricted as
   above and written into the stage's secrets. Its restrictions follow the
   graph on every deploy: add a site that calls Maps, and its host is
   allowed — the key stays the same.

**Android** keys are restricted by package *and* signing certificate. The
package is the app's `android.package`, read from its Expo config; the
certificates are `android.sha1`: Play's app signing key from Play Console's
*App integrity* page, and EAS's upload key. Without `sha1` the Android key is
restricted to its APIs alone, and the deploy says so. **iOS** keys are
restricted to `ios.bundleIdentifier`. A platform the Expo config does not name
gets no key.

**A browser key** needs a host to be restricted to: a site on a stage with no
domain stops the deploy with `MapsSiteHasNoHost`, since a browser key
restricted to no referrer is anyone's.

**A server caller of the map alone** — `apis: ['maps']` and an edge from an
endpoint — stops with `MapsServerKeyCallsNothing`: the map is drawn in a page
or a phone, and a server key has nothing to call.

**A key you set wins.** A key the stage's secrets already hold, that the
provider did not make, is used as it is and nothing is made for it.

`--rotate-keys` makes each key a successor; the old one is deleted by the
first deploy after the stage has run with the new one, or at once with
`--retire-old-keys` (see [Rotating a key](./providers.md#rotating-a-key)).

Every deploy checks each key a caller holds is in the stage's secrets, and
stops with `MapsNotProvisioned` if not.

See [Credentials → Google](./providers.md#google) for how the deploy signs in
to Google, locally and in CI.
