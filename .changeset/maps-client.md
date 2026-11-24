---
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

A `Maps` hands a server process a client, a test a fake, and a phone its native config

**A typed client.** `services.maps` was a bare key. It is now a client for
the web services the construct declares: `geocode` and `reverseGeocode`
(`geocoding`), `searchPlaces` and `placeDetails` (Places API (New)),
`computeRoutes` (Routes API) and `staticMapUrl` (`static-maps`). Only the
declared APIs exist on its type, so a call the key is not restricted to does
not build. A refused call throws `MapsRequestFailed`, each call is traced like
an `ExternalApi`'s, and `apiKey` is still there for anything not covered.

**A fake under `gkm test`.** The test stage hands a `Maps` a fake key, and
Google's Maps hosts are answered in-process by a built-in, deterministic fake
(`@geekmidas/constructs/maps/fake`). A project can replace it with
`mapsFake(handler)` at `test/fakes/<id>.ts`. `gkm dev --fake` does not fake
Maps.

**Native config for a phone.** `react-native-maps` reads its keys from native
config, not JavaScript. The config plugin `@geekmidas/constructs/maps/expo`
puts the `EXPO_PUBLIC_` keys there, and `gkm eas:sync` refuses, with
`MapsKeysNotInNativeConfig`, an app that depends on a `Maps` and never hands
them over.

`gkm init` writes a mobile app's `android.package` and `ios.bundleIdentifier`
on its `MobileApp`.
