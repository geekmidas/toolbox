# Request-Scoped Logging in Singleton Services

## Problem

Services in `@geekmidas/services` are **singletons**. `ServiceDiscovery.register()`
(and `get()`) instantiates a service **once**, caches the instance in an internal
`Map`, and returns that same instance for every subsequent request:

```ts
// ServiceDiscovery.register()
if (this.instances.has(name)) {
  return this.instances.get(name); // cached — register() does NOT run again
}
const instance = await service.register({ envParser, context: serviceContext });
this.instances.set(name, instance);
```

The per-request logger, on the other hand, is **not** a singleton. On every request
an adaptor builds a fresh child logger with request-specific bindings and stores it
in `AsyncLocalStorage` via `runWithRequestContext`:

```ts
// e.g. HonoEndpointAdaptor
const logger = endpoint.logger.child({
  requestId,          // unique per request
  endpoint, route, host, method, path,
});

return runWithRequestContext({ logger, requestId, startTime }, async () => {
  const services = await serviceDiscovery.register(endpoint.services);
  // ...handle request...
});
```

### The bug

`service.register()` runs **inside the first request's context**. If a service reads
the logger **at registration time** and stores the concrete reference:

```ts
const databaseService = {
  serviceName: 'database' as const,
  register({ context }) {
    const logger = context.getLogger(); // ❌ resolved ONCE, during request #1

    return {
      async query(sql: string) {
        logger.debug({ sql }, 'Executing query'); // always request #1's logger
      },
    };
  },
} satisfies Service<'database', Database>;
```

…then `logger` is frozen to the **first** request's logger forever, because
`register()` never runs again. Every later request reuses the cached service
instance, so its logs carry the **first** request's `requestId` (and any user/session
bindings).

**Symptom:** logs make it look like the user who made the *first* request after a
cold start is responsible for actions actually performed by *other* users on later
requests. Request correlation, per-user log filtering, and audit trails are all
silently wrong.

This is an easy mistake to make because `register()` is handed a `context` object,
and "grab the logger once and reuse it" looks reasonable — but it is incompatible
with the singleton lifecycle.

## Solution

`serviceContext.getLogger()` returns a **stable, request-scoped proxy logger**
instead of the raw logger. The proxy holds no logger of its own — on **every** log
call it re-resolves the current request's logger from `AsyncLocalStorage`:

```
proxy.info('x')  →  asyncLocalStorage.getStore().logger.info('x')   // resolved at call time
```

Because resolution happens per call (not at capture time), capturing the logger once
during `register()` is now **safe**: the single captured reference routes each call
to whichever request is currently executing.

```ts
register({ context }) {
  const logger = context.getLogger(); // ✅ now safe to capture — it's a live proxy

  return {
    async query(sql: string) {
      logger.debug({ sql }, 'Executing query'); // logs to the CURRENT request
    },
  };
}
```

### Child loggers compose correctly too

`proxy.child(bindings)` returns **another** proxy carrying the bindings, applied lazily
on top of the current request's logger at call time:

```ts
register({ context }) {
  // Captured once. `{ svc: 'db' }` is the static part; the per-request bindings
  // (requestId, user, ...) come from whichever base logger is current.
  const logger = context.getLogger().child({ svc: 'db' });

  return {
    async query(sql: string) {
      // request A → loggerA.child({ svc: 'db' }).debug(...)
      // request B → loggerB.child({ svc: 'db' }).debug(...)
      logger.debug({ sql }, 'Executing query');
    },
  };
}
```

### Implementation

See `createRequestScopedLogger` in
[`src/context.ts`](../src/context.ts):

- `getLogger()` still **throws eagerly** if called with no active request context,
  preserving the "catch bugs early" contract.
- The returned object is a shared, process-wide proxy. It carries no request state,
  so sharing it across requests is safe — `AsyncLocalStorage` provides correct
  per-async-context isolation, and each resolve/log call is synchronous (no `await`
  between resolving and using the logger), so it is concurrency-safe.
- Each `child()` call returns a new proxy that remembers its bindings and rebuilds
  the child chain off the current base logger, memoised per underlying logger to
  avoid rebuilding the chain on every log line.

## Guidance for service authors

- ✅ You **may** capture `context.getLogger()` (or a `.child()` of it) once in
  `register()` and reuse it — it stays correct per request.
- ✅ You **may** also call `context.getLogger()` inside each method; behaviour is
  identical.
- ⚠️ Do **not** wrap the proxy in something that snapshots a concrete logger, e.g.
  `const real = someConcreteLogger; ...` outside the proxy. Resolution only stays
  live while you go through the proxy returned by `getLogger()`/`.child()`.
- ⚠️ Calling a log method outside any request context throws
  (`called outside request context`). Guard background work with
  `serviceContext.hasContext()` if it may run detached from a request.

## Tests

Regression coverage lives in
[`src/__tests__/context.spec.ts`](../src/__tests__/context.spec.ts):

- `captured-once logger follows each request (singleton service fix)` — a logger
  captured during the first request still logs to the second request's logger.
- `child loggers also follow the current request` — the same guarantee for
  `.child()` proxies.
- `should delegate to the current request logger` — basic delegation.
