---
'@geekmidas/cli': major
---

`gkm init --monorepo` scaffolds constructs, not an `apps` block

It was the last thing producing the shape v10 removed. A scaffolded workspace
got a `gkm.config.ts` naming three apps — type, path, port, framework,
dependencies — with `envParser` and `logger` as module paths beside them, which
is precisely what the surface replaced.

The generated config is three keys: the name, the constructs glob, and secrets.
Everything else it used to write, it wrote twice. `services` is gone, because a
declared database is why a Postgres exists. `deploy` is gone, because that is
picked at deploy time and it was writing the default anyway. `shared` is gone
because nothing reads it.

In its place is a `constructs/` directory at the workspace root — the database
and the auth server's schema in it, the surface, the auth server, the site —
reached from the apps through the `@<name>/constructs/*` path the tsconfig maps.

`apps/auth` loses its hand-written Hono server: the PORT read, the CORS list
split out of `BETTER_AUTH_TRUSTED_ORIGINS`, the `/api/auth/*` mount and the
Better Auth instance behind them. The `BetterAuth` construct declares all of it
and the build generates the entry, because the routes are a wildcard no glob
can find.
