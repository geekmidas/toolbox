---
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

An OpenAPI document lists its servers, contact and licence

A surface's document now lists `servers`, one per stage in the workspace's
`domains`, at the surface's label under that stage's domain —
`https://api.staging.myapp.com`, `https://api.myapp.com`. The served
`/__docs` document and the generated client's `apiInfo.servers` both carry
them.

`new RestApi(id, { contact, license })` fills the document's `info.contact`
and `info.license`, and the generated client's `apiInfo`.
