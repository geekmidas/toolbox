# @geekmidas/client

Type-safe API client utilities with React Query integration.

## Installation

```bash
pnpm add @geekmidas/client
```

## Features

- Type-safe API client with automatic type inference
- React Query hooks generation from OpenAPI specs
- Typed fetcher with error handling
- Automatic retries and request/response interceptors
- Query invalidation utilities
- W3C trace context on requests to its own API, opt-in

## Package Exports

| Export | Description |
|--------|-------------|
| `/` | Core client types |
| `/fetcher` | Typed fetcher implementation |
| `/infer` | Type inference utilities |
| `/react-query` | React Query integration |
| `/openapi` | OpenAPI client utilities |
| `/types` | Type definitions |
| `/auth-fetcher` | Auth-aware fetcher with per-endpoint security strategies (Bearer, API key, AWS IAM) |
| `/endpoint-hooks` | `createEndpointHooks` - React Query hooks generated from typed fetcher |
| `/telemetry` | `ClientTelemetryOptions` - W3C trace context propagation ([below](#trace-propagation)) |

## Basic Usage

### Typed Query Client

```typescript
import { createTypedQueryClient } from '@geekmidas/client';
import type { paths } from './openapi-types';

const api = createTypedQueryClient<paths>({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});

// Type-safe queries
const { data, isLoading } = api.useQuery('GET /users/{id}', {
  params: { id: '123' }
});

// Type-safe mutations
const mutation = api.useMutation('POST /users');
await mutation.mutateAsync({ body: { name: 'John', email: 'john@example.com' } });
```

### Typed Fetcher

```typescript
import { createTypedFetcher } from '@geekmidas/client/fetcher';
import type { paths } from './openapi-types';

const fetcher = createTypedFetcher<paths>({
  baseURL: 'https://api.example.com',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Type-safe API calls
const user = await fetcher('GET /users/{id}', {
  params: { id: '123' },
});

const newUser = await fetcher('POST /users', {
  body: { name: 'John', email: 'john@example.com' },
});
```

### Wrapped Fetcher (No-Throw)

Use `.wrap()` to create a client that never throws — instead returning `{ ok, data }` or `{ ok, error }`:

```typescript
import { createTypedFetcher } from '@geekmidas/client/fetcher';
import type { paths } from './openapi-types';

const client = createTypedFetcher<paths>({
  baseURL: 'https://api.example.com',
});

const wrappedClient = client.wrap();

const result = await wrappedClient('GET /users/{id}', {
  params: { id: '123' },
});

if (!result.ok) {
  // only `error` exists on the failure branch
  console.error('Request failed:', result.error);
  return;
}

// only `data` exists on the success branch, fully typed
console.log(result.data.name);
```

#### Error Transformer

Pass a callback to `.wrap()` to transform errors into a typed shape. The error type is inferred from the callback return:

```typescript
const wrappedClient = client.wrap(async (error) => {
  const res = error as Response;
  const body = await res.json();
  return { status: res.status, message: body.message };
});

const result = await wrappedClient('GET /users/{id}', {
  params: { id: '123' },
});

if (!result.ok) {
  // result.error is typed as { status: number; message: string }
  console.error(result.error.status, result.error.message);
}
```

Without a callback, `error` defaults to `unknown`.

#### Preserving Properties

`.wrap()` copies any extra properties (like `useQuery`, `useMutation`) from the original client to the wrapped function, so hooks survive wrapping:

```typescript
const client = createTypedFetcher<paths>(options);
const hooks = createEndpointHooks<paths>(client);
Object.assign(client, hooks);

const wrappedClient = client.wrap();
// wrappedClient.useQuery and wrappedClient.useMutation still work
```

#### Type Reference

```typescript
type WrappedResult<T, E = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: E };
```

Interceptors like `onRequest`, `onResponse`, and `onError` still run as usual — `.wrap()` only changes how errors surface to the caller.

### React Query Integration

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import { createQueryKey, createMutationFn } from '@geekmidas/client/react-query';

// Create query key factory
const userKeys = {
  all: ['users'] as const,
  detail: (id: string) => [...userKeys.all, id] as const,
};

// In your component
function UserProfile({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: userKeys.detail(userId),
    queryFn: () => fetcher('GET /users/{id}', { params: { id: userId } }),
  });

  if (isLoading) return <div>Loading...</div>;
  return <div>{data?.name}</div>;
}
```

### Query Invalidation

```typescript
import { useQueryClient } from '@tanstack/react-query';

function CreateUserForm() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: CreateUserInput) =>
      fetcher('POST /users', { body: data }),
    onSuccess: () => {
      // Invalidate all user queries
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      mutation.mutate({ name: 'John', email: 'john@example.com' });
    }}>
      {/* form fields */}
    </form>
  );
}
```

## OpenAPI Type Generation

Each surface's typed client is written by `gkm build` (and kept current by
`gkm dev`) to the workspace root's `.gkm/client/<surface>.ts`, imported as
`@<name>/client/<surface>`: its `createApi()` returns a typed
fetcher with React Query hooks, built from the endpoints themselves rather
than from a spec file.

## Trace propagation

With `telemetry` on, every request a client makes **to its own API's origin**
carries W3C trace context, so a user action in the browser and the API request
it causes are one trace. A request to any other origin carries none.

```typescript
const api = createApi({
  baseURL: import.meta.env.VITE_API_URL,
  telemetry: { sampleRate: 0.1 }, // or `true` for every page view
});
```

Which context it sends:

- **An OpenTelemetry context is active** — a browser SDK has a span open, or the
  client runs on a server (a Next.js server component, an API calling another
  API) inside a request span. The globally registered propagator writes the
  headers (`traceparent`, `tracestate`), so the current span is the parent.
- **Otherwise (level 1).** One trace id per page view — per page load in a
  browser, shared by every client on the page; per client in Node — a fresh
  span id per request, and a sampled flag decided once per page view at
  `sampleRate` (default 1). The ids are crypto-random.

`@opentelemetry/api` is not a dependency. Every copy of it registers its
globals on `globalThis` under `Symbol.for('opentelemetry.js.api.1')`, and the
client reads the propagator and context manager from there — so with no SDK on
the page it costs nothing, and with one it finds it. The whole feature adds
about 0.7 kB gzipped to a bundle.

A `traceparent` the caller sets itself is left alone. The React Query hooks go
through the same fetch, so they carry it too.

The sampled flag is decided from the trace id by the same rule as
OpenTelemetry's `TraceIdRatioBasedSampler`. The API caps an incoming sampled
flag at its own rate by that rule, so a page view sampled at the stage's rate
is sampled at the API too — and a page cannot force more.

### The API's side

- **CORS.** A `RestApi`'s CORS — derived from the sites with an edge to it —
  always allows the `traceparent` and `tracestate` request headers, so a
  preflight for them passes.
- **Trust.** The API continues the context only from its own sites' origins
  and from internal callers; anyone else's starts a new trace linked to it.
  See [whose trace context is
  continued](/packages/telescope#whose-trace-context-is-continued).

### The generated client

`gkm` writes `createApi` with telemetry **off** unless told otherwise; a
caller's own `telemetry` option always wins. The default the generated module
prints is `telemetryDefault`, set by:

```bash
gkm openapi --telemetry        # on, every page view sampled
gkm openapi --telemetry 0.1    # on, at the stage's rate
```

A site's Docker image runs the same `gkm openapi --app <api>` for each API it
calls, and passes `--telemetry` when the site's telemetry asks for it. Driving
that from a site's `Telemetry` construct, with the stage's rate, is the next
step of the telemetry work; until then pass `telemetry` to `createApi`.

