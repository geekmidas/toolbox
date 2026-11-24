---
'@geekmidas/cli': minor
---

`gkm provision --stage <stage>`: a stage's providers on their own — each provider's `ensure()` and `verify()`, the records they ask for and the keys they write — with nothing built or released. `gkm deploy` runs the same step first. The local stage can be provisioned too, for the kinds with no local stand-in: each provider kind says what it is locally in one place (`LOCAL_PROVIDER_RULES`). `objects`, `email` and `inbox` are served by MinIO and Mailpit and `mobile` means nothing locally, so `deploy.<kind>.<local>` for them fails to load with `ProviderNotForLocalStage`; `maps` has no emulator, so `deploy.maps.<local>` is allowed and `gkm provision --stage <local>` creates its keys, the browser key restricted to each site's host on the local edge.
