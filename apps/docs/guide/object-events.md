# Object Events

A bucket can tell your app when its objects change. A handler bound to an
`ObjectStorage` runs when an object is written under a key it watches, or
when one is deleted. You declare it once, with no cloud in the code.

```typescript
// constructs/storage.ts
import { ObjectStorage } from '@geekmidas/constructs/object-storage';

export const uploads = new ObjectStorage('Uploads');

// subscribers/avatars.ts
import { uploads } from '../constructs/storage.js';
import { worker } from '../constructs/worker.js';

export const onAvatar = worker
  .objects(uploads)
  .on(['object.created'], { prefix: 'avatars/', suffix: '.png' })
  .handle(async ({ objects, logger }) => {
    for (const object of objects) {
      // { bucket, key, size, etag, versionId? }
      logger.info({ key: object.key }, 'avatar uploaded');
    }
  });
```

A bucket works like a [topic](/packages/constructs) whose publisher is the
storage itself. The subscriber is bound to the bucket, as a topic subscriber
is bound to its topic. It runs in a `Worker`, is handed the worker's database
as `db`, and names its own `.dependsOn([...])`.

## What a handler is handed

| Field | What it is |
|---|---|
| `objects` | Each object that changed: `{ bucket, key, size?, etag?, versionId? }`. The key is decoded, so `a b.png` arrives as written, not as `a+b.png`. |
| `events` | The same objects with what happened to each, `{ type, payload }`. Use it when a handler reacts to both events. |
| `services`, `logger`, `db` | As for any subscriber. |

Two events exist: `object.created`, for any write (a put, a copy, a multipart
upload), and `object.deleted`.

Being told an object changed is not the same as reading it. A handler that
reads or writes the bucket depends on it explicitly:

```typescript
export const thumbnails = worker
  .objects(uploads)
  .dependsOn([uploads])
  .on(['object.created'], { prefix: 'originals/' })
  .handle(async ({ objects, services }) => {
    for (const { key } of objects) {
      // write under thumbnails/, outside the prefix this handler watches
    }
  });
```

### A handler must not feed itself

A handler that depends on the bucket it watches, and watches every key in it,
would run again for each object it writes. The build refuses it with
`ObjectSubscriberFeedsItself`. Watch a prefix, and write outside it.

## How events are delivered

The handler's process reads `<BUCKET>_EVENTS_CONNECTION_STRING`. Only the
processes that run one of the bucket's subscribers are given it, and they are
not given the bucket's own URL unless they also depend on the bucket.

- **`sns://`**: the storage publishes to an SNS topic. The handler is
  pushed to over HTTP on a server (at `/__gkm/subscribers/<export>`), or
  invoked as a Lambda. This is the case for an S3 bucket, on every target. A
  server build includes the push route even when the app's own events go
  through pg-boss.
- **Anything else** (for example `pgboss://`): the handler polls the broker,
  as a topic subscriber does, for `object.created` and `object.deleted`
  messages relayed onto it.

The handler filters what it is sent: by event, then by prefix and suffix. Its
filter is final, whatever the source already filtered. A test event, which S3
sends when a notification is configured, is answered and runs nothing.

## A bucket in MinIO

MinIO has no topic to publish a bucket's events to, so where MinIO holds a
watched bucket (under `gkm dev`, and in a compose stack that runs its own
MinIO), it posts each event to the process that runs the bucket's
subscribers, and that process relays it onto the broker:

1. MinIO is started with a webhook target per watched bucket, and the bucket
   is pointed at it for every created and removed object. gkm writes both.
   Nothing to configure.
2. The process mounts `POST /__gkm/objects/<Bucket>`. MinIO presents the
   bucket's token (`<BUCKET>_EVENTS_TOKEN`), compared in constant time, and
   anything else gets 401.
3. Each event is published onto the broker under the bucket's name, as
   `object.created` or `object.deleted`. The route answers 2xx only once
   every event is published. Otherwise MinIO keeps the event and sends it
   again.
4. Every subscriber of the bucket drains a queue of its own, and filters by
   prefix and suffix as above.

Where it posts:

- **`gkm dev`**: the dev server of the app that builds the worker running the
  bucket's subscribers, through `host.docker.internal` on that app's port.
  Only the local stage's buckets post. `gkm test` shares the MinIO, and its
  uploads reach the test's subscribers in-process instead (see Testing).
- **A compose stack**: the worker's container, across the stack's own
  network. The route is on no public host.

MinIO starts before whatever it posts to. What it cannot deliver yet, it
keeps on disk and sends once the route answers. Nothing is lost while the
worker restarts.

The token is derived, never stored. Locally it comes from the project, since
everything it protects is on loopback. In a stack serving a deployed stage it
comes from that stage's random seed, so it is a secret there.

A bucket whose events come from SNS (an S3 bucket, or a stage that sets
`<BUCKET>_EVENTS_CONNECTION_STRING` itself) gets no webhook target. The two
paths never both deliver. On an AWS target's `gkm dev`, where the broker is
SNS, MinIO relays nothing.

## Write handlers to run twice

Delivery is at least once. S3 and MinIO can report the same change twice, and
out of order. So:

- **Make the handler idempotent.** Key what it does on `key` plus `etag`, or
  `versionId` on a versioned bucket, so a repeat is a no-op.
- **Keep it short.** A pushed handler runs inside the delivery's HTTP
  request. Slow work, such as transcoding, should be handed to a queue
  (`services.jobs.publish([...])`) so the handler can return at once.
  Otherwise the delivery times out and is retried.

## Testing

In a `featureTest`, a bucket's changes reach its subscribers in-process, in
the test's transaction:

- An upload or delete through the bucket's client, `services.uploads`, is
  reported to the subscribers watching that key. This works from a handler
  (delivered once the request answers) and from the test itself (delivered at
  once).
- An upload the app never sees, such as a browser posting to a presigned
  URL, is reported with `objects(bucket).emit(...)`:

```typescript
it('makes a thumbnail for each original', async ({ objects, db }) => {
  await objects(uploads).emit({
    type: 'object.created',
    key: 'originals/cat.png',
    size: 1024,
  });

  // assert on what the handler wrote
});
```

A subscriber can also be run on its own with `subscriber(onAvatar).invoke({
events: [{ type: 'object.created', payload: { bucket, key } }] })`.
