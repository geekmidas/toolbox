---
'@geekmidas/constructs': minor
'@geekmidas/cli': patch
---

:sparkles: `featureTest`: read what a fake received through `fake(construct)`, not a relative import (#119)

`fake(shipping)` returns the named exports of `test/fakes/shipping.ts` — the same module instance the test stage serves — keyed by the construct like `queue(…)` and `published(…)`, and typed from the module, so a fake the app does not declare is a type error. The default export (the served fake) is not handed out; an image fake throws `ImageFakeHasNoState`, and a construct with no fake `NoFakeFor`.

`featureTest`'s `fakes` option now takes each fake's module rather than its default export, and the generated harness passes them (`import * as __ShippingFake`), typed as `featureTest`'s fourth generic. The delivery errors from #115 (`DeliveryFailed`, `MessageRejected`, `DeliveryDidNotSettle`) are now exported from `@geekmidas/constructs/testing`.
