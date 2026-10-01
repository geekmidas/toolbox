---
'@geekmidas/db': patch
'@geekmidas/cli': patch
'@geekmidas/cloud': patch
---

A database's owner role can create trusted extensions

A migration running `create extension if not exists citext` failed with
`permission denied to create extension "citext"`. The extension is trusted, so
a role without superuser may create it, but Postgres also requires `CREATE` on
the database itself. Each construct's owner role (the one migrations run as)
was confined to its own schema, and nothing granted that.

`roleStatements` now takes `database` for a database construct's roles and
adds `GRANT CREATE ON DATABASE <database> TO <owner>`. All three provisioners
pass it for a database, and only for a database:

- reconcile (`gkm dev`, `gkm test`, `gkm migrate`);
- the Dokploy deploy;
- the AWS bootstrap Lambda.

A schema tenant's owner (`.schema('AuthDatabase')`) is unchanged and stays
confined to its own schema. The app's runtime role is untouched.

**Existing databases** get the grant on the next reconcile or deploy. The
statement is idempotent.
