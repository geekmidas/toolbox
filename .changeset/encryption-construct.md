---
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
'@geekmidas/cloud': minor
'@geekmidas/envkit': minor
'@geekmidas/cli': minor
---

:sparkles: `Encryption` — a key that encrypts what the application stores

`new Encryption('Pii')` gives a handler that `.dependsOn([pii])` `services.pii.encrypt`, `decrypt`, `index` (a blind index, so an encrypted column can still be looked up) and `reencrypt`. The app names no cipher: the construct provides one `PII_URL` whose scheme picks the backend.

- **Locally and in tests**, an `aes256gcm://` keyring derived from the project and stage, like a secret — nothing to set.
- **On a server stage**, a keyring generated into the stage's secrets on its first deploy and never replaced by a redeploy.
- **On AWS**, envelope encryption under a KMS key that rotates yearly, and a KMS HMAC key for the index, each granted to exactly the functions that depend on the construct (`kms:GenerateDataKey`/`kms:Decrypt`, `kms:GenerateMac`). `@aws-sdk/client-kms` is an optional peer, loaded only for a `kms://` URL.

Every ciphertext names the key that wrote it and is bound to its construct. `gkm encryption:rotate <Id> --stage <stage>` adds a key and keeps the old ones; after a `reencrypt` sweep, `gkm encryption:retire <Id> <key> --stage <stage>` removes one, and a value still under an old key warns the first time it is decrypted. The index key never rotates.
