---
'@geekmidas/cli': patch
'@geekmidas/constructs': patch
---

An app's compose environment is its edges, not the whole workspace

`docker-compose.constructs.yml` gave every app every key the workspace
resolved — a web app got the database's owner URL and the auth server's
signing secret, the API got the auth server's database. Each app's service now
holds what its own declaration provides and requires, and what each construct
it has an edge to provides: a site also gets the public variants its bundle
inlines, and the generated API server the edges of the workers whose crons it
runs.

Found with it, in `@geekmidas/constructs`:

- `api.database(db)` (and a function's or cron's `.database(db)`) wired the
  database's service but never recorded the edge, so nothing composed from the
  edges — a container's environment, a deploy's grants — knew the endpoint
  reached a database. It is recorded like any `.dependsOn()`.
- `BetterAuth` had no way to declare what its `options` use — the mailer a
  magic link goes through, usually — so that edge was invisible. It has
  `.dependsOn([...])` now.
