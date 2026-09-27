---
'@geekmidas/cli': patch
---

`gkm init` names what it declares plainly: `Database`, `Cache`, `Uploads`, `Mail`

The scaffold named them after the project — `new Cache('BeetlefitCache')`,
`new KyselyDatabase<Database, 'Beetlefit'>('Beetlefit')` — but the workspace
`name` already scopes every physical name, so the cache deployed as
`production-beetlefit-beetlefit-cache`. The ids are now plain, and so are the
keys they publish: `DATABASE_URL`, `DATABASE_OWNER_URL`, `CACHE_URL`,
`UPLOADS_URL`, `MAIL_URL`.

Existing projects are unaffected; a project scaffolded before this keeps its
ids until it renames them.
