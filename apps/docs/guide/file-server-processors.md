# File Server Processors

A processor is a handler behind one path pattern of a [file server](../packages/constructs.md):
it makes a derivative of an open object when it is read — a thumbnail, a page
of a PDF rendered as an image — rather than when it was uploaded. Every object
already in the bucket is covered with no backfill, and a new size is a line of
config.

```typescript
// processors/thumbnails.ts
import sharp from 'sharp';
import { z } from 'zod';
import { assets } from '../constructs/storage';

export const thumbnails = assets
  .process('/i/:width/*')
  .params(z.object({ width: z.enum(['64', '256', '512', '1024']) }))
  .native(['sharp'])
  .handle(async ({ params, object }) => ({
    body: await sharp(await object.bytes())
      .resize(Number(params.width))
      .webp()
      .toBuffer(),
    contentType: 'image/webp',
    cache: 'immutable',
  }));
```

```typescript
// anywhere that depends on the file server
services.assets.processedUrl(thumbnails, { width: '256' }, 'avatars/7.png');
// → https://assets-server.example.com/i/256/avatars/7.png
```

## The pattern

A literal first segment, then any `:name` parameters, then `*` for the
object's key: `/i/:width/*`, `/pdf/:page/:dpi/*`. The edge routes on the
literal prefix (`/i/`), so a pattern beginning with a parameter is refused
(`ProcessorPatternInvalid`) — it would claim every path on the domain.

## The parameters' schema is the allowlist

Every request is parsed by `.params()` before anything runs. A value it
refuses is answered `400`, cached for a minute, and the handler never runs —
so nobody can mint new work, or new cache entries, by varying a number. Without
a schema the handler is handed the raw strings.

## Open paths only

A processor serves exactly what an unsigned read would: a key no `open`
pattern admits is answered `404`, and `processedUrl()` throws `NotOpen` for
one. A private object is never processed.

## What the handler gets and returns

| Context | |
|---|---|
| `params` | the schema's output, or the raw strings |
| `key` | the object's key, decoded |
| `object` | the source, read from the bucket on first use: `bytes()`, `stream()`, `contentType()` |
| `services` | what `.dependsOn([…])` named |
| `logger` | |

It returns `{ body, contentType, cache? }`. `cache` is:

- `'immutable'` — `Cache-Control: public, max-age=31536000, immutable`, and the
  result is **kept in the bucket** under `.gkm-derived/`, so the next request
  for it is answered from there without running the handler. Only for results
  that can never change for these parameters and this key.
- `{ maxAge: seconds }` — kept that long by browsers and the CDN; nothing is
  written to the bucket.
- `'none'` — `no-store`.

The default is an hour. A missing object is `404`, cached for a minute; a
handler that throws is `500`, not cached.

### How long kept results stay

What is kept under `.gkm-derived/` is a cache: remade on the next request if
it is gone. So the bucket deletes it after 30 days, through the same lifecycle
rules as `expire` — on S3 and on MinIO alike. Change it on the file server:

```ts
new FileServer('Assets', { open: ['**'], derived: { days: 7 } });
```

Two file servers over one bucket keep them for the longer of the two.

## Where it runs

| Target | Runs as | Reached through |
|---|---|---|
| `gkm dev` | the dev server of the app holding the processors, under `/__gkm/processors/<FileServer>` | the file server's local host: the edge rewrites each pattern there, every other path to MinIO |
| Compose, bucket in the stack's MinIO | its own container, `<fileserver>-processors`, built from the app holding the processors | the file server's host: the patterns go to the container, every other path to the bucket |
| Compose, bucket on S3 (the `s3` provider, CDN on) | the same container | CloudFront: each pattern is a behaviour whose origin is the container's own host, `<fileserver>-server-processors.<domain>` |
| Dokploy, bucket on S3 (CDN on) | an application of its own, from the same image | CloudFront, at the same host; the unit checks the CDN's header itself |
| SST | a Lambda behind a function URL with IAM auth | the file server's router, on the pattern's prefix, signed with origin access control |

`processedUrl()` answers under `gkm dev` as it does deployed, and the dev
server reloads processors with the rest of its code.

Its own container because making a derivative is CPU-bound: a resize spike in
the API's process would be every request's latency.

### The origin only the CDN may call

On compose with an S3 bucket, the processor container's host is public — a CDN
reaches its origin over the internet. The deploy that creates the CDN
generates a secret, keeps it in the stage's secrets as
`<FILESERVER>_SERVER_ORIGIN_SECRET`, and has CloudFront send it as
`X-Gkm-Origin-Verify` on every request. The stack's edge refuses any request
without it (`403` under Caddy; no matching router, so `404`, under Traefik)
and answers only the processors' prefixes. A stack composed before that
deploy has run fails with `ProcessorOriginSecretMissing`, naming the key.

Dokploy's proxy routes by host alone and cannot match a header, so there the
unit is handed the secret (`GKM_PROCESSOR_ORIGIN_SECRET`) and refuses a
request without it itself, `403`, compared in constant time. Its health check
needs no header. A Dokploy file server over MinIO answers on MinIO itself,
path-style, with no host to route a pattern on, so processors there fail the
deploy with `ProcessorsNeedCdn`: put the bucket on S3 behind the CDN.

## Telemetry

Give the file server the `Telemetry` construct, as a worker takes it:

```ts
new FileServer('Assets', { open: ['**'], telemetry });
```

The processor unit then starts OpenTelemetry, and each request it answers is a
SERVER span named after the processor's pattern — `GET /i/:width/*`, never the
key — with `http.route`, `url.path` and the status. The deploy hands the unit
the stage's `OTEL_*` keys. Without the edge, the unit loads no tracing at all.

## Native packages

`.native(['sharp'])` names packages with native code. They are left out of
the bundle and installed for the platform the processor runs on: linux in its
image, at the version the build resolved; `nodejs.install` on Lambda. Add them
to the app's dependencies.
