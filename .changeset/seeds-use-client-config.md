---
'@geekmidas/cli': patch
---

Seeds get the database's own client

`gkm seed` used to give each seed a bare Kysely, so a `CamelCasePlugin` declared on the construct did nothing in a seed. A seed typed against the camel-cased `Database` failed with `column "isEditable" … does not exist`. Seeds now build their client from the construct's `clientConfig` on the owner's connection, the same client a handler or a test gets. A schema tenant's seeds use the tenant's own options and never its parent's.

Migrations keep a bare client. A casing plugin would rewrite their DDL too, and a migration that has already run must never change.
