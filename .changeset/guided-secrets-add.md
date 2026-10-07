---
'@geekmidas/cli': minor
---

`gkm secrets:add --stage <stage>`: a guided builder for the keys a stage must be given, across every app in the workspace.

- It offers exactly what a deploy would refuse the stage without — each bucket's, mail server's and file server's keys on a deployed stage, and every external API's and `Credential`'s `<ID>_CREDENTIALS` on any stage — each once, with its construct, kind, the apps that read it, and whether it is set. Derived values (database URLs, generated secrets, the seed) are never offered. The list is `requiredStageKeys`, the same one `ExternalServicesNotConfigured` is built from.
- Each key is built by kind: a bucket from AWS S3, Cloudflare R2, an S3-compatible endpoint or a pasted URL, with an optional key of its own written percent-encoded into the URL (or the stage's shared `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`); mail as an `smtp://`/`smtps://` URL and a validated from address; a file server's `https://` address; credentials field by field from the construct's schema, re-asked with each issue's path until the schema accepts them. A set key asks before it is replaced. Values are saved through the stage's own store and never printed.
- `--missing --json` prints the keys (`key`, `kind`, `construct`, `apps`, `set`) and asks nothing. Without a terminal and without `--json` it fails with `SecretsAddNeedsTerminal`.
- `gkm secrets:set` checks a `<ID>_CREDENTIALS` value against its construct's schema and fails with `CredentialsInvalid`, saving nothing. A `dokploy` or `compose` deploy checks every stored credential the same way in `validate`, before anything is built. Neither message carries the value.
- `ExternalServicesNotConfigured` now ends with `Or run: gkm secrets:add --stage <stage>`.
