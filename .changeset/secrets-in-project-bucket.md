---
"@geekmidas/cli": minor
---

Add the `s3` secrets store, `secrets: { store: { provider: 's3' } }`. It keeps each deployed stage's secrets as one object, `<prefix>/<project>/<stage>/secrets.json`, in the project bucket next to the deploy state, or in a named bucket that already exists.

- **Encryption and history:** objects are written with SSE-S3 and kept by the bucket's versioning. There is no size limit.
- **Concurrent writes:** each write is conditional on the ETag that was read, so a lost race fails with `StageSecretsChanged`.
- **Bucket creation:** the bucket is created on the first write, never on a read.
- **Defaults:** `region` and `prefix` default to an S3 `state`'s.
- **Scaffold:** `gkm init --deploy sst` now scaffolds `state: { provider: 's3' }` with the `s3` secrets store. Existing configs keep the store they name.
- **Migration:** `gkm secrets:migrate --to s3` copies the stage, reads it back to verify, and is idempotent. It never deletes the source; it prints the command that would.
- **CI role:** `gkm deploy:github` grants the CI role `s3:GetObject`/`s3:PutObject` on the secrets object instead of the SSM parameter.
