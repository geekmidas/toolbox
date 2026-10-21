---
'@geekmidas/constructs': minor
'@geekmidas/storage': minor
'@geekmidas/schema': minor
---

Direct uploads: `.upload(bucket, …)` on an endpoint

An endpoint can now hand the browser a signed form that uploads one file
straight to a bucket, so the file never passes through the server:

```ts
export const avatarUpload = router
  .post('/me/avatar')
  .upload(uploads, {
    key: ({ session }) => `avatars/${session.userId}.png`,
    maxSize: 5 * 1024 * 1024,
    accept: ['image/png'],
  })
  .handle(async ({ upload }) => upload); // { url, fields, key, expiresAt }
```

The endpoint chooses the key, resolved from the session, body and params. The
form's policy, enforced by the storage itself, refuses a file over `maxSize`
(`content-length-range`) or of a type `accept` does not allow. The bucket
becomes a dependency, as with `.dependsOn([bucket])`. The form is the
endpoint's typed and documented output unless an `.output()` came first. A
policy fixes one type or one prefix (`image/*`), so an endpoint that accepts
several types says which one this upload is with `contentType`. A type outside
`accept` is refused with a 415. Options that could never be honoured fail when
the module loads.

- `@geekmidas/storage`: `StorageClient.getUploadPost({ key, maxSize, contentType?, expiresIn? })`,
  a presigned POST whose policy limits size and type.
- `@geekmidas/schema`: a Standard Schema that implements Standard JSON Schema
  (`~standard.jsonSchema`) converts to JSON Schema whatever its vendor. A
  hand-written schema can now be documented in OpenAPI.
