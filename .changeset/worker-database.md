---
'@geekmidas/constructs': minor
'@geekmidas/cli': patch
---

`worker.database(db)` is now the default database for everything built from the worker: crons, queues, subscribers and functions receive it as `db`, typed from the construct, and it still names where a server keeps cron schedules. `.database(other)` on a cron, queue or subscriber overrides it — retyping `db` and replacing the manifest edge rather than adding to it. Queues and subscribers gain `.database()`, carry `databaseService`, and contribute the database's env; the Lambda, test and generated server runtimes (`queues.ts`, `subscribers.ts`, SNS push) pass `db` to their handlers.
