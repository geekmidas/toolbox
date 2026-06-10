---
'@geekmidas/cli': minor
---

feat(cli): add `gkm test --auto-setup` to self-provision a stage in CI

`gkm test` previously required a local secrets file and the matching `~/.gkm`
encryption key, so it could not run on a fresh CI checkout (where `.env` and
`.gkm/` are gitignored).

With `--auto-setup` (or the `GKM_AUTO_SETUP` env var), `gkm test` now
regenerates a fresh stage from the committed `gkm.config.ts` when no secrets
exist — minting service credentials and a local key, then starting Docker with
those values. For tests this is safe because the credentials are ephemeral local
service passwords used to bring up the matching containers. The behavior is a
no-op when secrets already exist and is scoped to `gkm test` only.
