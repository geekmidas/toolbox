# @geekmidas/manifest

The seam between build and run: the declaration types every construct emits, the
naming rules every key derives from, and the graph functions a target reads.

One runtime dependency (`lodash.snakecase`) and no framework imports, on
purpose — the producer (`@geekmidas/cli`) and the consumers (deploy targets)
share a data contract, not a library.

## Installation

```bash
pnpm add @geekmidas/manifest
```

You rarely import it directly. A construct resolves its own env key through it,
and `gkm build` writes a manifest with it; you reach for it when writing a
target, a codegen step, or a construct of your own.

## The manifest

Every construct, keyed by its id:

```typescript
import type { ConstructManifest } from '@geekmidas/manifest';

const manifest = {
  Orders: { kind: 'database', id: 'Orders', engine: 'postgres', schema: 'app',
            version: 18, provides: ['ORDERS_URL'] },
  Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
} as const satisfies ConstructManifest;
```

Flat rather than grouped, because a dependency resolves as `manifest[target]` —
an O(1) lookup that is identical whether the edge points at a resource, a
surface, or another function.

Use it as a **constraint, not an annotation**: `as const satisfies
ConstructManifest` checks the shape while keeping the literal types, so
`IdsOf<typeof manifest>` is `'Orders' | 'Uploads'` rather than `string`.

## Declaration kinds

Fifteen, as a discriminated union — exhaustiveness *and* per-kind fields, with
no shape carrying a field that belongs to a different kind. Thirteen of them are
things a target *provisions*; `function` and `cron` carry a handler and reach a
target through the function pipeline instead:

| Kind | Declared by | Notes |
|------|-------------|-------|
| `database` | `KyselyDatabase` | `engine`, `schema`, `version`, `roles` |
| `database-reader` | `database.reader()` | derives from a database or a schema tenant |
| `database-schema` | `database.schema()` | its own role and URL |
| `objects` | `ObjectStorage` | `versioned` |
| `file-server` | `FileServer` | derives from `objects` — it shares the parent's *contents*, not its credentials |
| `cache` | `Cache` | `of` + `table` when declared from a database — entries are a table in it |
| `email` | `Email` | |
| `secret` | — | platform-generated, one opaque string |
| `credential` | `Credential` | third-party, several fields, validated |
| `rest-api` | `RestApi` | `authorizers`, `defaultAuthorizer`, nested `endpoints` |
| `site` | `StaticSite` | `variant` selects how values are delivered |
| `topic` | `Topic` | `events`, nested `subscribers` |
| `queue` | `Queue` | `fifo`, nested `worker` |
| `function` / `cron` | `f` / `c` | carry a `handler` |

Triggered functions **nest inside the surface that triggers them**, so there is
no `trigger` field — position carries it.

### What is not in it

**Permissions.** The manifest records what is depended on; what that implies on
a given cloud — an IAM policy, a security group, a link — is the target
adapter's business. A portable contract that named `sns:Publish` would not be
portable.

## Naming

Every key in the system comes from these four functions, which is what keeps the
key a target publishes and the key a client reads from drifting apart:

```typescript
import { canonicalId, provideKey, serviceKey, cloudName } from '@geekmidas/manifest';

canonicalId('user-uploads');            // 'UserUploads'  — PascalCase
provideKey('Uploads', 'url');           // 'UPLOADS_URL'
provideKey('Orders', 'ownerUrl');       // 'ORDERS_OWNER_URL'
serviceKey('Uploads');                  // 'uploads'      — the handler's key
cloudName({ stage: 'prod', app: 'shop' }, 'UserUploads');
// 'prod-shop-user-uploads'
```

`uploads`, `Uploads`, `user_uploads`, and `user-uploads` all canonicalise to the
same id, so declaring two of them is a duplicate rather than a collision to
detect later. Ids are narrower than JavaScript identifiers — `_id` and `$ref`
are rejected — because an id also has to survive `environmentCase` into an env
key and `cloudName` into a DNS-safe resource name.

`serviceKey` is the runtime twin of the type-level `Uncapitalize<TName>`; the
two must agree exactly, which is why the id is written in PascalCase.

## Graph functions

```typescript
import {
  provisionOrder,
  dependenciesOf,
  dependentsOf,
  assertDerivations,
  isDerived,
  publicEnvFor,
} from '@geekmidas/manifest';

provisionOrder(manifest);       // parents before children
dependenciesOf(manifest, 'ListOrders');
dependentsOf(manifest, 'Orders');
assertDerivations(manifest);    // a child naming a parent that cannot be one throws
```

Resources stay leaves — a resource may not consume another construct — which
keeps the provisioning graph acyclic. `DERIVES_FROM` states exhaustively what
each derived kind may derive from, so cycles are impossible without a graph
walk: readers are terminal, and there is no `writer`, because the database *is*
the writer.

## See also

- [Constructs Paradigm](/guide/constructs-paradigm) — the design this implements
- [@geekmidas/constructs](/packages/constructs#constructs) — what emits these declarations
- [@geekmidas/cli](/packages/cli#reconcile) — what reads them locally
