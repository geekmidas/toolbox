# Typed API Client

Every `RestApi` surface gets a generated TypeScript client: one module per
surface, built from the endpoints themselves. It exports the OpenAPI path types,
the security schemes, a runtime map of which endpoint needs which authorizer,
and a `createApi()` that returns a typed fetcher with React Query hooks.

There is no JSON spec in between and no second tool to run.

::: tip Changed in v10
Older docs described `gkm openapi --output`, a `--json` mode, and
`gkm generate:react-query`, which ran `openapi-typescript` over a JSON file.
All three are gone. The client is written to a fixed place per surface, and
the React Query hooks are part of it.
:::

## Where it is written

The client belongs to the application, like its manifest. It is written at the
workspace root, one file per surface, named from the surface's id:

| Surface | File | Import |
|---|---|---|
| `new RestApi('Api', …)` | `.gkm/client/api.ts` | `@<name>/client/api` |
| `new RestApi('Webhooks', …)` | `.gkm/client/webhooks.ts` | `@<name>/client/webhooks` |

`<name>` is the workspace name. `gkm init` maps the alias in the root
`tsconfig.json` and in each frontend's own; see
[Workspaces: auto-generated API client](./workspaces.md#auto-generated-api-client).

It is written by:

- `gkm build`, as part of the build;
- `gkm dev`, on start and whenever endpoints change;
- `gkm openapi`, on its own (`--app <name>` for one backend app).

`.gkm/` is gitignored. Generate the client in CI before type-checking a
frontend that imports it.

## What it exports

```ts
// .gkm/client/api.ts (abridged)
export const apiInfo = { title: 'API Documentation', version: '1.0.0', … };

export const securitySchemes = {
  jwt: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
} as const;
export type SecuritySchemeId = 'jwt';

export const endpointAuth = {
  'GET /users/{id}': 'jwt',
  'POST /users': 'jwt',
  'GET /health': null,            // public
} as const;
export type EndpointString = keyof typeof endpointAuth;
export type AuthenticatedEndpoint = /* endpoints with a scheme */;
export type PublicEndpoint = /* endpoints without one */;

export interface User { id: string; email: string }   // from your schemas
export interface paths { '/users/{id}': { get: { … } }; … }

export function createApi(options: CreateApiOptions) { … }
```

## Using it

```ts
// apps/web/src/lib/api.ts
import { createApi } from '@shop/client/api';

export const api = createApi({
  baseURL: import.meta.env.VITE_API_URL,
  authStrategies: {
    jwt: { type: 'bearer', tokenProvider },
  },
});

// Imperative
const user = await api('GET /users/{id}', { params: { id: '123' } });

// React Query
const { data } = api.useQuery('GET /users/{id}', { params: { id: '123' } });
const createUser = api.useMutation('POST /users');
```

`createApi` takes:

- `baseURL`, required;
- `authStrategies`, one per security scheme the surface uses, keyed by the
  authorizer's name: `{ type: 'bearer', tokenProvider }`,
  `{ type: 'apiKey', apiKeyProvider, headerName? }`, `{ type: 'iam', signer }`
  or `{ type: 'none' }`. Each request gets the strategy of its endpoint's
  scheme, and public endpoints get none;
- `queryClient`, `onRequest` and `fetch`, all optional.

A surface with no authorizers gets a `createApi` without `authStrategies`; it
takes the plain fetcher options instead.

## Authorizers and security schemes

Each authorizer a surface names becomes a security scheme of the same name:

| Authorizer type | Security scheme |
|---|---|
| `jwt`, `bearer` | HTTP bearer, `bearerFormat: 'JWT'` |
| `iam`, `aws-sigv4`, `sigv4` | API key in `Authorization`, with `x-amazon-apigateway-authtype: awsSigv4` |
| `apikey`, `api-key` | API key in the `X-API-Key` header |
| `oauth2` | OAuth 2.0 |
| `oidc`, `openidconnect` | OpenID Connect |
| anything else | HTTP bearer |

An endpoint with no authorizer (`.authorizer('none')`, or a surface whose
`defaultAuthorizer` is `'none'`) maps to `null` in `endpointAuth` and is sent
without credentials.

## Configuration

There is nothing to configure. The file's place follows from the surface's id,
and there is no `output` option. Which endpoints a client covers follows from
the surface each endpoint is built from.

## See also

- [`@geekmidas/client`](../packages/client.md): the fetcher and hooks the
  client is built on
- [Workspaces: frontend integration](./workspaces.md#frontend-integration)
