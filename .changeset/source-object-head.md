---
'@geekmidas/storage': minor
'@geekmidas/constructs': minor
---

:sparkles: A processor's `object.size()` and `object.metadata()`, and `StorageClient.head(key)`, read an object's metadata with a HEAD rather than downloading it (#467)

`StorageClient` gains `head(key)`: `{ size, contentType?, etag?, lastModified?, custom }` from one `HeadObject`, or `undefined` when nothing is at the key. It records a `storage.head` span.

A file server processor's `SourceObject` gains `size()` and `metadata()`, backed by one memoised HEAD, so a size guard no longer downloads what it guards against. `contentType()` answers from the body's response when it was already read and from the HEAD otherwise, so asking for the type no longer downloads the body. A missing object throws `ProcessorSourceMissing` from any of them and is answered `404`.

A custom `StorageClient` implementation must now implement `head`.
