---
'@geekmidas/constructs': minor
'@geekmidas/storage': minor
'@geekmidas/manifest': minor
'@geekmidas/events': patch
'@geekmidas/cli': minor
---

Object events: subscribers that run when a bucket's objects change

`worker.objects(bucket).on(['object.created'], { prefix, suffix }).handle(…)`
binds a handler to an `ObjectStorage`. It is handed `objects` (each
`{ bucket, key, size?, etag?, versionId? }`, with the key decoded) and
`events` (the same objects with their `object.created` / `object.deleted`
type). It compiles down to a topic subscriber, so it runs through the same
Lambda, SNS push, polled and test adaptors.

- `@geekmidas/storage/events` reads an S3 or MinIO notification body into
  object messages (`toObjectEvents`): it decodes form-encoded keys, reads
  `s3:TestEvent` as no event, and throws `ObjectNotificationMalformed` on
  anything else. `matchesObjectFilter` is the prefix/suffix test.
- The adaptors read what the storage sends and filter by event, prefix and
  suffix themselves. Their filter is final, whatever the source filtered.
- The manifest nests a bucket's subscribers in its `objects` node
  (`subscribers`, with `events`, `prefix`, `suffix`). The handler's process
  reads `<BUCKET>_EVENTS_CONNECTION_STRING`, and is not given the bucket's URL
  unless it also depends on the bucket.
- A server build includes the SNS push route whenever a bucket has
  subscribers, even when the app's own events go through pg-boss. A bucket's
  push subscription sets no `type` filter policy (`subscribeHttpEndpoint`'s
  `events` is now optional).
- The build refuses `ObjectSubscriberFeedsItself`: a subscriber that depends
  on the bucket it watches and watches every key in it.
- Discovery's per-worker subscribers are now `{ name, connectionKey }`, so a
  compose worker gets its push host for a bucket's events as for a topic's.
- In a `featureTest`, an upload or delete through the bucket's client is
  delivered to its subscribers, and `objects(bucket).emit(...)` reports
  changes the app never sees, such as a presigned upload.
