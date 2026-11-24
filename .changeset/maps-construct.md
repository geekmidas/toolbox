---
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
'@geekmidas/cli': minor
---

`Maps`: a construct whose keys are restricted by what calls it, made by the deploy in a Google Cloud project

- **`new Maps('Maps', { apis: ['maps', 'places'] })`** from `@geekmidas/constructs/maps`. `apis` is what the app calls — `maps`, `static-maps`, `places`, `geocoding`, `routes` — and every key is restricted to them.
- **A key per kind of caller, read off the graph.** A server process that depends on it holds `MAPS_API_KEY` (`services.maps.apiKey`); a site `MAPS_BROWSER_KEY`, inlined under its bundle prefix; a mobile app `MAPS_ANDROID_KEY` and `MAPS_IOS_KEY`. Each caller is handed only its own (`mapsRolesFor`, `mapsCallers` in `@geekmidas/manifest`).
- **`deploy.maps.<stage> = { provider: 'google', project?, android? }`.** Every deploy finds or creates the project, turns on the APIs, stops with `MapsBillingDisabled` when no billing account is linked (gkm never links one), and makes each key: the browser key restricted to the calling sites' hosts, the Android key to the app's package and `android.sha1` certificates, the iOS key to its bundle id. Restrictions follow the graph on every deploy; `--rotate-keys` rotates them like every provider's keys. A key the stage set by hand is used as it is.
- `stageClouds` reports Google for a stage whose maps are made there.
