---
"@geekmidas/constructs": minor
---

Add `@geekmidas/constructs/middy` — Middy middlewares that bring request context and service discovery to standalone Lambda handlers:

- `requestContext(options?)` establishes a request context so `serviceContext.getLogger()` / `getRequestId()` / `getRequestStartTime()` work inside the handler and any service it calls.
- `addServices([...], options?)` resolves services via `ServiceDiscovery` and attaches the typed record to `event.services` (pair with `requestContext`, or use `withServices`, if your services read `serviceContext`).
- `withServices([...], options?)` bundles both in a single `.use(...)`.

Also exports an `EventServices<T>` helper type for typing the handler's event.
