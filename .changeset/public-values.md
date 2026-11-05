---
'@geekmidas/manifest': patch
'@geekmidas/cloud': patch
'@geekmidas/cli': patch
---

`@geekmidas/manifest` exports `publicValues()`, the one walk of a site's or app's edges that every target makes. `publicEnvFor`, `imageOriginSources` and the AWS target's site build now all read it, instead of each walking the edges itself. A site and a mobile app share a `PublicDeclaration` base, with `isPublicDeclaration()` to test for one. Nothing a bundle is built with changes.
