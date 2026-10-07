---
'@geekmidas/constructs': minor
---

`ExternalApi` and `Credential` expose their credentials schema as `credentialsSchema`, so a tool can check a value, and describe its fields, before it is stored. `decodeCredentials` — how a stored `<ID>_CREDENTIALS` value is read (JSON when it is JSON, the string otherwise, `json:` to keep a JSON string a string) — is exported from `@geekmidas/constructs/credential`.
