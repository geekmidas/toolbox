# Naming

Every physical name a deploy creates is derived from two things: the **construct
id** you wrote, and the **stage** you deployed to. Nothing is typed twice, and
nothing differs between providers.

## One rule, every provider

```
{stage}-{name}-{construct id}
```

`name` is the `name` in your gkm config — the same statement `sst.config.ts`
makes. So a `KyselyDatabase('Database')` in the `production` stage of an app
called `kitchen-sink` is:

```
production-kitchen-sink-database
```

on Dokploy **and** on AWS. It is literally the same function: `cloudName` in
`@geekmidas/manifest`, which the SST target re-exports as `prefixedName` rather
than reimplementing.

::: tip Why that matters more than it looks
These were once two implementations of "the same" rule. They agreed on every id
anybody had tried, and disagreed the moment one carried a digit beside a letter —
`S3Bucket` became `s-3-bucket` on one provider and `s3-bucket` on the other, for
the same construct. A name you cannot read across providers is not a name.
:::

## Casing

Ids are kebab-cased, acronym- and digit-aware:

| construct id | physical name |
|---|---|
| `Database` | `production-acme-database` |
| `AuthDb` | `production-acme-auth-db` |
| `APIKey` | `production-acme-api-key` |
| `S3Bucket` | `production-acme-s3-bucket` |
| `UserUploads` | `production-acme-user-uploads` |

The prefix is idempotent: an id that already carries the scope is not given a
second one, so composing names cannot double up.

## Where the rule differs, and why

**Postgres identifiers are snake_case**, because every identifier touching a
database is — so the *database* is `database_production` while the *service* it
lives in is `production-acme-database`. Two names, deliberately: one is what
Postgres calls it, the other is what the provider calls it.

**Buckets are DNS labels**, so they take the hostname rule rather than the
Postgres one: `uploads-production`, never `uploads_production`.

**Roles are cluster-scoped**, which is why they carry the stage even when the
database already does — two stages sharing one cluster cannot share a
credential.

## Images are not scoped

A Docker image keeps the project's plain name:

```
ghcr.io/acme/kitchen-sink:production-2026-09-06T10-39-02
```

One image is deployed to several stages, the registry path already scopes it,
and it is what somebody types after `docker pull`. The *tag* carries the stage;
the name does not.

## Hostnames are the exception

Everything above is structural — it does not vary by stage. A hostname does, so
it is config rather than derivation:

- the site holding the base domain gets `domains[stage]` — `example.com`
- everything else gets `{name}.{base}` — `api.example.com`, `admin.example.com`
- `app.domain` overrides either, per stage

Which site holds the base domain is itself declared, not guessed — one site is
the root because it is the only one, a site named `web` wins by convention, and
past that a site says `root: true`. Anything else is an error rather than a coin
toss. See [Sites and hostnames](/guide/deployment#sites-and-hostnames) for the
worked two-site example.

## Renaming

**A construct id is a physical name.** Renaming `Database` to `Orders` renames
the Postgres service, which means a new empty one — the old data does not
follow. Treat a construct id the way you would treat a table name in a
migration.

Moving a construct between files or apps is safe: identity is the id, and the
scope is the workspace, so neither changes.
