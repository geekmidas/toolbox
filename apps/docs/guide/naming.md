# Naming

Every physical name a deploy creates is derived from two things: the **construct
id** you wrote, and the **stage** you deployed to. Nothing is typed twice, and
nothing differs between providers.

## One rule, every provider

```
{stage}-{name}-{construct id}
```

`name` is the `name` in your gkm config — the same statement `sst.config.ts`
makes. On Dokploy, a workspace that sets `deploy.namespace` has it in front:
`{stage}-{namespace}-{name}-{construct id}`, because a Docker service name is
unique on the whole server (see [Identity](./deployment.md#identity-namespace-project-stage)). So a `KyselyDatabase('Database')` in the `production` stage of an app
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

## Images are scoped by namespace, not stage

An image is `{registry}/{namespace}/{name}-{app}`:

```
ghcr.io/acme/kitchen-sink/kitchen-sink-api:production-2026-09-06T10-39-02
```

The namespace is a path segment of its own, so two workspaces with one name
never push over each other's images, and a registry that grants access by path
can grant it per namespace. One image is still deployed to several stages, so
the *tag* carries the stage; the name does not.

## Hostnames are the exception

Everything above is structural — it does not vary by stage. A hostname does, so
it is config rather than derivation:

- each stage's base domain is `domains[stage]` in `gkm.config.ts`
- the site holding the base domain answers on it — `example.com`
- every other surface on `{subdomain}.{base}` — `api.example.com`,
  `admin.example.com` — where the subdomain is the construct's own
  `subdomain` option, or its id kebab-cased:

  ```ts
  new RestApi('Api', { path: 'apps/api', subdomain: 'v1' })  // v1.example.com
  new RestApi('Webhooks', { path: 'apps/hooks' })            // webhooks.example.com
  ```

  The same label is used locally under the project: `v1.shop.localhost`.

Which site holds the base domain is itself declared, not guessed. One site is
the root because it is the only one; a site named `web` wins by convention; past
that a site says `root: true` and anything else is an error rather than a coin
toss.

### A site on every subdomain

A multi-tenant app can serve each tenant on its own host,
`acme.example.com/orders/42`, by declaring one site with `subdomain: '*'`:

```ts
// endpoints/tenants.ts — 200 for a host it serves, 404 for anything else
export const tenantHosts = api
  .get('/tenants/hosts')
  .query(z.object({ domain: z.string() }))
  .handle(async ({ query, db }) => { … });

// constructs/app.ts
export const app = new StaticSite('App', {
  path: 'apps/app',
  variant: 'next',
  subdomain: '*',
  hosts: tenantHosts,
}).dependsOn([api, auth]);
```

- **Named hosts win.** `api.`, `auth.`, `admin.` and every other app keep their
  own hosts; the wildcard site gets whatever is left. It never holds the base
  domain, and a project has at most one.
- **`hosts`** is a `GET` endpoint the edge asks, `?domain=<host>`, before it
  serves a host. It runs without a session.
- **Protected subdomains.** A tenant can never take a label the stage needs:
  every app's own (derived, never listed) and the names no construct declares,
  listed once in the workspace config. Listing an app's own is an error:

  ```ts
  export default defineWorkspace({
    name: 'shop',
    domains: { production: 'example.com' },
    protectedSubdomains: ['www', 'mail', 'status', 'docs'],
  });
  ```

- **The app reads its tenant from the host.** The site is handed
  `APP_DOMAIN` (`example.com`, or `shop.localhost` locally) and
  `APP_PROTECTED_SUBDOMAINS` (comma-separated), both inlined for its bundle
  (`NEXT_PUBLIC_APP_DOMAIN`), so the leading label comes off the request's
  host without hard-coding the domain.
- **Origins follow.** A surface the site depends on trusts
  `https://*.example.com` in its CORS and in Better Auth's `trustedOrigins`:
  any one label, never the domain itself or two labels deep.

Locally the site answers on `*.shop.localhost` (`*.test.shop.localhost` for
`gkm test`). Deployed targets do not route every subdomain yet: `gkm compose`
and the AWS target refuse a wildcard site by name rather than serve nothing.

## Renaming

**A construct id is a physical name.** Renaming `Database` to `Orders` renames
the Postgres service, which means a new empty one — the old data does not
follow. Treat a construct id the way you would treat a table name in a
migration.

Moving a construct between files or apps is safe: identity is the id, and the
scope is the workspace, so neither changes.
