---
'@geekmidas/manifest': patch
'@geekmidas/constructs': patch
'@geekmidas/cloud': patch
'@geekmidas/cli': patch
---

One derivation for every manifest value:

- **`publicValues()`** is the one walk of a site's or app's edges that every target makes. `publicEnvFor`, `imageOriginSources` and the AWS target's site build now read it instead of each walking the edges themselves.
- **`PublicDeclaration`** is the base a site and a mobile app share, with `isPublicDeclaration()` to test for one.
- **`provideKey` is no longer exported** from `@geekmidas/manifest`. Every provided key comes from `providedKeyFor(id, kind, role)`, which knows each kind's naming rule. Code that imported `provideKey` moves to `providedKeyFor`, or to `environmentCase` for a name that isn't a provided key.

No env key or value changes.
