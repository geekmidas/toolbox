---
'@geekmidas/cli': patch
---

Deploys now seed. `gkm compose` (and `gkm deploy --target compose`) and the Dokploy target migrated a stage but never ran its seeds, so reference data such as roles and permissions was missing on every deployed stage. Both now run every seed (`db/<construct>/seeds`) after the migrations and before any app starts — every deploy, every stage, as `gkm seed --help` always said — so seeds must be idempotent upserts. Dokploy runs them in the deploy's sandbox, beside the migrations. A failing seed stops the release with `DeploySeedsFailed`, naming the construct and the seed and keeping the cause. Each run reports `🌱 db/<construct>/seeds: ran N` and `migration.applied` / `seed.ran` events; a dry run lists the seeds it would run. `gkm compose --build --push` still runs neither.
