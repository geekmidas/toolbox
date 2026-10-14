---
'@geekmidas/constructs': patch
'@geekmidas/cli': patch
---

The KMS cipher is a driver, registered only by an entry built for AWS. `Encryption` no longer loads `@aws-sdk/client-kms` itself: `registerCipherDriver(kmsCipherDriver)` from `@geekmidas/constructs/encryption/kms` is in the generated entry of an AWS build that reaches an `Encryption`, and nowhere else — so a server app with `aes256gcm://` keys neither bundles nor imports the SDK. A `kms://` key with no driver registered fails with `UnregisteredEncryptionScheme`.

`gkm build` no longer leaves missing optional peers external (from alpha.116): that hoisted `@aws-sdk/client-kms` to a static import and the server crashed on start. A bundle that needs a package nothing installed fails the build again.
