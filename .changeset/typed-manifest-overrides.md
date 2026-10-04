---
'@geekmidas/cloud': minor
'@geekmidas/cli': patch
---

:boom: `fromManifest`'s overrides are typed from the manifest

The overrides were `Record<string, Record<string, unknown>>`, so a misspelt id or a prop nothing reads went through without complaint, and a missing database `vpc` or mail `from` only showed up at synth, partway through a deploy. They are now `ManifestOverrides<typeof constructs, typeof backends>`:

- **Keys:** only the manifest's own construct ids.
- **Values:** what each construct's kind actually takes. Props the declaration already decides are left out, such as a database's `schema`, a queue's `fifo` or a site's `path`.
- **Required:** what the synth won't guess. That means a database's `vpc` and mail's `from`. Some depend on the backend: ElastiCache needs `vpc`, and Resend or SMTP mail needs `url`.
- **No key:** kinds with nothing to override, such as a database's reader or schema, a cache that lives in a database, functions and crons.

`ComponentOverrides` is removed, and `overrides` is now a required argument (pass `{}` when there is nothing to say). A manifest typed only as `ConstructManifest` still accepts the untyped record. The synth-time checks stay for anything that isn't typed.
