---
'@geekmidas/cli': minor
'@geekmidas/manifest': patch
---

Object events from a bucket in MinIO, under `gkm dev` and in a compose stack

A bucket's subscribers had nothing to receive locally: MinIO has no topic to
publish to. Where MinIO holds a watched bucket, gkm now starts it with a
webhook target per bucket and points the bucket at it, for every created and
removed object. MinIO posts each event to the process that runs the bucket's
subscribers, at `POST /__gkm/objects/<Bucket>`, presenting the bucket's token
(`<BUCKET>_EVENTS_TOKEN`, derived, compared in constant time). That process
relays each event onto the broker under the bucket's name, as `object.created`
or `object.deleted`, and answers 2xx only once it is published. MinIO keeps
what it could not deliver on disk and sends it again, so events written before
the worker is up are not lost.

- **`gkm dev`**: MinIO posts to the dev server of the app that builds the
  worker, through `host.docker.internal`. Only the local stage's buckets post,
  so `gkm test`'s uploads never reach it.
- **Compose**: MinIO posts to the worker's container across the stack's own
  network. The route is on no public host, and the token comes from the
  stage's seed.

A worker container now serves the POST routes its subscribers mount beside
its health check, and subscribes its pushed routes once it answers. A bucket
whose events come from SNS gets no webhook target. Bucket notifications are
merged: only gkm's own `gkm-<Bucket>` rule is added or removed, and any other
rule on the bucket is kept.
