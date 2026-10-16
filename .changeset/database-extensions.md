---
'@geekmidas/manifest': minor
'@geekmidas/constructs': minor
'@geekmidas/db': minor
'@geekmidas/cli': minor
'@geekmidas/cloud': minor
---

A database declares PostGIS: `new KyselyDatabase('Geo', { extensions: ['postgis'] })`

PostGIS is not in the stock Postgres image, and it is not a trusted extension,
so the owner role a migration runs as cannot create it. The only way to get it
was a `postgis/postgis` pin in the project's `docker-compose.yml`, which covered
local dev for the whole project and no deployed stage.

It is now declared on the database, and each target acts on that one database:

- **Local** (`gkm dev`/`test`/`setup`): the shared Postgres container runs
  `postgis/postgis:<major>-<postgis>-alpine` when any database declares it.
  PostGIS is a superset of Postgres, so the other databases are unaffected.
- **Dokploy**: that database's own cluster runs the Debian `postgis/postgis`
  image. An already-deployed cluster is moved onto it when the Postgres major
  and C library match. Otherwise the deploy fails with
  `ImageCannotGainExtensions` rather than starting a data directory on an image
  it cannot safely run on. A new cluster now also runs the declared `version`:
  every Dokploy cluster used to be created as `postgres:18`.
- **AWS**: RDS ships PostGIS; the bootstrap creates it.

On every target the cluster master runs
`CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public` in that database, before
the first migration. `public` joins its roles' `search_path` behind the schema,
so `geometry` resolves unqualified while tables still land in the schema.
`roleStatements` takes the new `extensions` field.
