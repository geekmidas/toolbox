---
'@geekmidas/cli': patch
---

Seeds are handed the stage's custom secrets, as its apps are

A seed's `env` held what reconcile resolves — every construct's URL — but
not the keys set with `gkm secrets:set`, which the apps do get. A seed that
needed one (a client id it upserts, a third party's key, an admin's email)
found it missing under `gkm seed` and `gkm dev --seed`, and only worked under
`gkm exec`.

`gkm seed` (and `gkm migrate`) now merge the stage's stored secrets under the
resolved URLs, reading the local stage's store for `test` as `gkm test` does.
`gkm dev --seed` hands the seeds the same env it starts the apps with.
