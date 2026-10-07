---
'@geekmidas/logger': minor
---

Redaction masks the credentials of any URL in a log line: `s3://KEY:SECRET@uploads` is written as `s3://REDACTED@uploads`, in any field at any depth and in the message. Path redaction cannot catch a URL, which turns up under any name (`url`, `origin`, `endpoint`). A URL with a user and no password is left as it is. It is on whenever redaction is, and off with `redact: false`. `redactUrlCredentials` is exported from `@geekmidas/logger/redact`.
