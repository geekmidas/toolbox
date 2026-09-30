---
'@geekmidas/cli': patch
---

The scaffolded AGENTS.md sets database hygiene

Migrations hold schema, never data. Data the code defines — a permission
catalogue, system roles — lives in the code, once, typed and in a shared
package every app imports; the database stores only what users create. A rule
("every user is a member") is logic, not a row; nothing needs seeding to run;
a backfill is the one exception; and a test that only keeps two copies in step
means one copy should go.
