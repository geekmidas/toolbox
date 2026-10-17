---
'@geekmidas/manifest': minor
'@geekmidas/constructs': minor
'@geekmidas/db': minor
'@geekmidas/cli': minor
'@geekmidas/cloud': minor
---

A database names its own image and extensions

```ts
new KyselyDatabase('Geo', {
  image: 'postgis/postgis:18-3.6-alpine',
  extensions: ['postgis'],
});
```

The only way to run PostGIS used to be a `postgis/postgis` pin in the
project's `docker-compose.yml`. That covered local dev for the whole project and
no deployed stage.

- **`image`** replaces `postgres:<version>` wherever a target runs a container.
  It's `version` or `image`, never both: the options are a discriminated union,
  because the image's tag already says the major. It's used as written, and it's
  the project's choice: it should ship the extensions listed.
  - **Local:** the shared container runs it. Two databases naming different
    images fail with `ConflictingPostgresImages`.
  - **Dokploy:** that database's own cluster runs it, including an existing
    cluster, on its next deploy.
  - **AWS:** runs RDS, ignores it, and provisions the default major.
- **`extensions`** are created in that database by the cluster master, before
  the first migration, on every target:
  `CREATE EXTENSION IF NOT EXISTS <name> SCHEMA public`. The owner role a
  migration runs as can't create an untrusted extension such as PostGIS. This is
  only attempted: an image without the extension fails with Postgres's own
  error. `public` joins the database's roles' `search_path` behind the schema,
  so `geometry` resolves unqualified. `roleStatements` takes the new
  `extensions` field.

A new Dokploy cluster with no `image` now runs `postgres:<version>`. Every
cluster used to be created as `postgres:18`.
