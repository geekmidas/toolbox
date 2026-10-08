---
'@geekmidas/cli': patch
---

:boom: Starting a stage no longer stores the addresses constructs derive; a deploy refuses a stage holding a stale one, and `gkm secrets:unset` removes it

- **No per-app database URLs or passwords.** `gkm setup`, `gkm test --auto-setup` and `gkm secrets:reconcile` stored `<APP>_DATABASE_URL` (a `postgresql://…@localhost:5432/…` URL) and `<APP>_DB_PASSWORD` for each backend app, and `http://localhost:<port>` as `<APP>_URL` for each site. `gkm init` stored `AUTH_URL` the same way. Those keys can be a construct's — `database.schema('AuthDatabase')` provides `AUTH_DATABASE_URL`, `new BetterAuth('Auth', …)` provides `AUTH_URL`, `new StaticSite('Web', …)` provides `WEB_URL` — and a stored value wins over a derived one, so `gkm compose` handed the auth server `localhost` with a password no role had: `ECONNREFUSED 127.0.0.1:5432` on every session check while `/health` still passed. None of them is written now.
- **A stage holding one is refused, not silently fixed.** `gkm compose` and a Dokploy deploy fail validate with `StaleStageSecrets` when a stored key that a database, tenant, API or site provides holds a `localhost`/`127.0.0.1` URL, naming each key and the `gkm secrets:unset <KEY> --stage <stage>` that removes it. Nothing is deleted for you. A managed database set with its real host still wins, as before. `gkm dev` and `gkm test` need nothing: there the derived address already wins.
- **`gkm secrets:unset <KEY> --stage <stage>`** removes one custom secret from the stage's own store (file, SSM or Secrets Manager), keeping the rest; a key the stage does not hold fails with `SecretNotSet`.
- **No stored pg-boss credential.** The `pgboss` service credential, the `EVENT_PUBLISHER_CONNECTION_STRING` composed from it, and the `PGBOSS_DB_*` keys it injected are gone: the broker URL is derived from the declared database's role, and the stored password matched none.
- **No `docker/.env`.** `gkm setup` wrote the `*_DB_PASSWORD` keys there for a Postgres init script nothing generates any more; reconcile creates each role from the stage's credential. The scaffold no longer gitignores it.
- **A stored `<APP>_DATABASE_URL` is no longer renamed onto `DATABASE_URL`** when an app's secrets are loaded (`gkm dev`, `gkm exec`, `gkm test`); `loadSecretsForApp` takes no app name.
