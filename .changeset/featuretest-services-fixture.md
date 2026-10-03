---
'@geekmidas/constructs': minor
'@geekmidas/cli': patch
---

:sparkles: `featureTest`: a `services` fixture — assert through the client a handler gets, with the fake behind it hidden (#119)

`await services.get('shipping')` returns what a handler depending on that construct is handed, resolved the way the test's endpoints resolve it: an external API's client aimed at whatever the test stage resolved (its fake, which the test never sees), a topic or queue as its recorder, a database as the test's transaction. The generated harness types it per service name (`ClientOf<typeof shipping>`); a name the app does not declare is a type error, and `UnknownService` at runtime.

A test asserts on an external API through the provider's own contract — the fake implements the provider's read endpoints too — so the same assertion holds against the provider's sandbox. Fakes stay hidden: tests no longer import a fake's module to read its state.

The delivery errors from #115 (`DeliveryFailed`, `MessageRejected`, `DeliveryDidNotSettle`) are now exported from `@geekmidas/constructs/testing`.
