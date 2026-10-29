---
'@geekmidas/cli': patch
---

A bucket's links reach a phone on a local stage with a mobile app

A surface a mobile app calls hands it links its buckets built: a file
server's public URL (`https://assetsserver.<project>.localhost:…`) and an
object store's presigned ones (signed for `localhost`). A phone resolves no
`*.localhost` host and reaches no `localhost`, and a presigned URL's
signature covers its host, so nothing downstream could move it.

When a surface a mobile app calls depends on a bucket, the local stage now
resolves the bucket on the LAN address, as it already does `<ID>_DEVICE_URL`
for an auth server: an `ObjectStorage` presigns against
`endpoint=http://<lan>:<minio port>`, and a `FileServer` links to
`http://<lan>:<minio port>/<bucket>`. A file server with processors stays
behind the edge, which is the only place they answer. A project with no
mobile app, or a machine on no network, resolves what it did before.
