---
'@geekmidas/storage': minor
---

A bucket URL may carry its own credentials: `s3://KEY:SECRET@bucket?region=…`

- `s3Url.parse` reads the userinfo into `accessKeyId`/`secretAccessKey`, percent-decoded, and `s3Url.build` writes them percent-encoded, so a secret with `/` or `+` round-trips. The `s3://` driver signs with them, over anything in the environment; a URL without them uses the SDK's default chain, as before (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, a profile, a role).
- A URL with only one half of a key pair fails with `IncompleteStorageCredentials`, naming the missing half in `missing`. It is never completed from the environment.
- Every storage error's `url` has its userinfo replaced by `REDACTED`, including a malformed URL whose secret was not encoded. `redactStorageUrl` is exported for callers' own log lines.
