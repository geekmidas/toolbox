# Access: Roles and Permissions as a Construct

- **Status:** Draft, open questions below
- **Impact:** High: a new construct, a new surface method, a new endpoint form
- **First user:** beetlefit (replaces its hand-written access control)

## Why

Every app with staff screens rebuilds the same thing, and beetlefit shows how
it goes wrong:

- **Four tables written by hand:** `permissions`, `roles`,
  `role_permissions`, `user_roles`.
- **A permission catalogue that exists twice:** it's `PERMISSIONS` in
  `apps/api/src/access.ts`, and again as rows inserted by
  `002_create_access_control.ts`, with a test whose only job is to keep the
  two in step. Adding a permission means writing a migration, and granting it
  to Super admin means writing another.
- **Data in a migration:** the system roles and their grants are inserted by
  the migration, when they're seed data.
- **A permission lookup written by hand** in `sessionRouter`.
- **A Better Auth hook written by hand** that grants `Member` to every new
  user.
- **The catalogue is reachable only from the API.** The web app and the Expo
  app gate screens on permissions too, and can't import a typed list.

It's the same every time, apart from tenant-based apps, which add one key.
So it should be a toolbox concept that every app uses.

## Decisions made

Settled in discussion. Don't reopen these without a new reason:

- **The `permissions` table stays.** `role_permissions` references it by
  foreign key, and an admin UI lists it. A proposal to drop it in favour of
  the constant alone was rejected.
- **There's no "super admin" concept in code:** no flag, no column, no
  special case in session resolution. Super admin is a role that holds every
  permission through `role_permissions` rows.
- **Migrations hold schema, not data.** The rows in `permissions` and the
  declared roles' grants come from the construct's sync, never from a
  migration.
- **Access is a toolbox concept shared by every app,** not something each
  app builds. Tenant-based apps use the same model plus a tenant key.
- **The permission catalogue is defined once, typed, and shared.** Every app
  (API, web, Expo) gates on the same `Permission` type.

## Model

**Roles and grants are data.** There's no "super admin" concept anywhere in
code. A role is a row, and what it may do is its `role_permissions` rows.
"Super admin" is a role that happens to hold every permission.

Tables, owned by the construct:

```
permissions       key (pk), description
roles             id, name, managed | initial | custom, [tenant_id]
role_permissions  role_id → roles, permission_key → permissions
user_roles        user_id, role_id → roles, [tenant_id], granted_by
```

- **`permissions` stays a table.** `role_permissions` references it by
  foreign key, and an admin UI lists it with descriptions. Its rows come from
  the catalogue in code, synced, not inserted by a migration.
- **The catalogue is defined once, in code, typed** (`as const`), and exported
  so every app (API, web, Expo) uses the same `Permission` type.

## The construct

```ts
// constructs/access.ts
export const access = new Access('Access', {
  database: accessDatabase,            // a schema tenant, like Better Auth's
  permissions: {                       // the catalogue: typed, `as const`
    'tournaments.create': 'Create private tournaments',
    'users.view': 'View users',
    // …
  },
  roles: {                             // declared roles and their grants
    Member: { grants: ['tournaments.create', 'tournaments.join'], mode: 'initial' },
    'Super admin': { grants: '*', mode: 'managed' },  // every permission, now and later
  },
  default: 'Member',                   // granted to every new user
});

export type Permission = PermissionOf<typeof access>;
```

- **Schema and migrations:** it owns its tables in its own tenant, with
  migrations in `db/access/`, generated like Better Auth's
  (`gkm migration access`). No app hand-writes these tables again.
- **Catalogue sync:** after `gkm migrate`, in the test setup, and on deploy,
  it upserts `permissions` from the catalogue and declared roles' grants from
  `roles`. Adding a permission is one line in the construct: the row appears,
  and `'*'` roles are granted it. Apps don't write seed files for any of this.
- **The default role:** it's granted to a new user through Better Auth's
  user-created hook, which replaces beetlefit's hand-written one.

### Declared roles vs custom roles

One `roles` table, three kinds of row:

| Kind | Created by | Grants owned by | Editable at runtime |
|---|---|---|---|
| `managed` | the declaration | code: the sync enforces them | no, read-only in an admin UI |
| `initial` | the declaration, once | admins, after creation | yes |
| custom | an admin, at runtime | admins | yes |

The sync only ever touches `managed` roles' grants, and creates `initial` ones
if they're missing. It never touches custom roles.

### Runtime management

Handlers that depend on the construct get a typed service:

```ts
await services.access.roles.create({ name: 'Food reviewer', permissions: ['foods.review', 'foods.edit'] });
await services.access.roles.grant(roleId, ['foods.import']);
await services.access.users.assign(userId, roleId);
```

- **In code:** `permissions` is the `Permission` union, so a typo doesn't
  compile.
- **From an admin form:** input is validated at runtime against the
  catalogue (`PermissionSchema`), and the foreign key backs that up.
- **Protection:** editing a `managed` role throws a named error.
- **Admin endpoints stay the app's:** they're built on this service, behind
  a permission, audited like any staff action.

## The surface: `RestApi.access(access)`

The split follows `.auth(auth)`: `.access()` is a fact about the surface,
`.authorize()` is the endpoint's grant.

```ts
export const api = new RestApi('Api', { path: 'apps/api', defaultAuthorizer: 'none', logger })
  .auth(auth)       // who you are
  .access(access);  // what you may do
```

- **The session:** every session on this surface carries
  `permissions: Permission[]`, resolved from `user_roles` → `role_permissions`,
  plus typed `session.can(...)` and `session.require(...)`.
- **An edge:** the API → Access link is recorded, so the API's container
  gets the access tenant's URL.
- **It requires `.auth()`:** permissions belong to a user, so `.access()`
  without `.auth()` is a type error, and a named error at runtime.

## The endpoint: `.authorize()`

Three cases, three tools:

1. **Pure permission:** the shorthand, typed to the surface's catalogue.
   Every key named is required.
   ```ts
   .get('/users').authorize('users.view')
   ```
2. **Permission, or ownership decidable from the request:** the function
   form, with a typed `session.can()`.
   ```ts
   .get('/users/:id')
   .authorize(({ session, params }) =>
     session.can('users.view') || params.id === session.user.id)
   ```
3. **Permission, or ownership that needs the row:** checked in the handler,
   after the one load, instead of loading the row twice.
   ```ts
   .handle(async ({ db, session, params }) => {
     const tournament = await db.selectFrom('tournaments')…executeTakeFirstOrThrow();
     session.require('tournaments.moderate', { unless: tournament.createdBy === session.user.id });
   })
   ```

No session gives 401. A session without the permission gives 403, whether it
fails in `.authorize()` or in `session.require()`.

The key form goes into OpenAPI; a function can't. See open question 5 for a
declarative "or owner" form.

## The apps

The catalogue's types and a `hasPermission(held, ...required)` helper are
exported from the construct's module. `/profile` (or whatever the app's
session endpoint is) returns `permissions: Permission[]`, and web and Expo
gate on the same keys. A misspelt or removed permission fails to compile in
every app.

## Tenant-based apps

It's the same model with one more key:

- **`user_roles.tenant_id`:** a person holds roles per tenant.
- **Global or per-tenant roles:** `roles` are global (`Super admin`) or
  belong to one tenant (a customer's own "Manager"). Custom roles belong to
  the tenant they were created in, and only that tenant's admins see or
  assign them.
- **Resolution:** permissions are resolved for (user, tenant), with the
  tenant taken from the request by a resolver declared on the construct
  (`tenant: { resolve: … }`: a header, subdomain or path).
- **Unchanged:** `.authorize('users.view')`. It now means "in this tenant".

## Removing a permission

A key removed from the catalogue may still be granted by custom roles, which
is data someone chose. So the sync mustn't silently strip it. It stops with a
named error listing the custom roles that grant the key, and continues only
once those grants are removed or the removal is explicitly confirmed.

## Open questions

1. **Package:** a construct in `@geekmidas/constructs`, next to `BetterAuth`
   (it depends on the database construct and on auth), or its own
   `@geekmidas/access`? Leaning constructs.
2. **Sync on deploy:** should `'*'` roles pick up new permissions
   automatically on deploy? Leaning yes: the sync runs there anyway.
3. **Removed permissions:** refuse with a named error until confirmed, or
   delete and cascade? Leaning refuse (above). And what does "confirmed"
   look like: a flag on `gkm migrate`, or a `removed: [...]` list on the
   construct?
4. **Ownership: rule or permission?** Is owning something a fixed rule in
   code ("the creator may edit it"), or grantable (`tournaments.edit_own`
   next to `tournaments.edit_any`, so a role can have it taken away)?
   Grantable fits custom roles, but doubles some keys.
5. **Declarative ownership:** add a combinator, e.g.
   `.authorize(anyOf('users.view', owner(({ session, params }) => …)))`, so
   "permission or owner" shows in OpenAPI and to the apps? Or is the function
   form enough?
6. **`initial` vs `managed` defaults:** which is the default mode for a
   declared role? Should `Member` be editable per deployment?
7. **Tenant resolution:** where does the tenant come from by default, and is
   it the same resolver an app already uses for tenant-scoped data (RLS via
   `withRlsContext`)?
8. **Seeds in general:** this construct syncs its own data, so apps don't
   need seed files for access. Is there any other reference data that would
   need a general `db/<construct>/seeds/` mechanism, or does "the construct
   that owns it syncs it" cover everything?

## Where things stand (2026-09-30)

This design came out of cleaning up beetlefit's migrations. For picking up
where this left off:

**Merged**
- toolbox #93 (released in alpha.30):
  - `gkm migrate` and `gkm migration`;
  - `db/<kebab-case construct>/` folders, resolved once by `migrationTargets()`
    in `@geekmidas/manifest`;
  - the `@geekmidas/cli/vitest` global setup;
  - `gkm dev` reporting pending migrations;
  - `BetterAuth#pendingMigration()`.
- beetlefit #117: alpha.30, with migrations moved into `db/database/` and
  `db/auth-database/`.

**Open**
- **toolbox #94** (database hygiene in AGENTS.md): **needs correcting before
  merge.** It says a catalogue the code defines shouldn't be a table ("a
  table holding them is a copy… keep the constant") and that "nothing needs
  seeding to run". Both contradict this design, where `permissions` stays a
  table filled by a sync. What it should say:
  - migrations hold schema, not data;
  - data a construct owns is synced by the construct;
  - the catalogue is defined once, typed, and shared;
  - sample data comes from factories.

**Not started**
- **beetlefit migration names:** rename `001_`–`003_` to timestamps, and
  update the local test database's `app.kysely_migration` rows to the new
  names so nothing re-runs.
- **beetlefit 002:** remove the inserts. With this construct, beetlefit's
  four tables and its hand-written lookup and hook go away entirely, so 002
  becomes the construct's migrations instead.
- **Migrations on deploy:** PR B (Dokploy) and PR C (the AWS migrate
  function).
- **Local dev databases:** `gkm migrate` once in beetlefit. The local dev
  database never had its app tables.
