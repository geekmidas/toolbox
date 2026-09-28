---
'@geekmidas/cli': patch
---

A deployed stage's secrets live in a store: `secrets.store` in gkm.config.ts

`.gkm/` is gitignored, so the encrypted secrets file a deploy decrypts was
never on a CI runner. `secrets.store` says where a deployed stage's secrets
live instead:

- `'file'` (default) — the encrypted `.gkm/secrets/<stage>.json`, as before.
- `{ provider: 'ssm', region }` — one `SecureString` per stage,
  `/gkm/<name>/<stage>/secrets`, in the AWS account of the active credentials.
- `{ provider: store }` — any object with `pull(stage)` and `push(stage, secrets)`.

The local stage always stays in the file.

`gkm secrets:push --stage <stage> [--profile <p>]` and `gkm secrets:pull`
move a deployed stage's secrets to and from its store; `--profile` resolves
only that profile, never `AWS_*` from the environment. The generated
`deploy.yml` for SST runs `gkm secrets:pull --stage "$STAGE"` after assuming
the stage's role, and no longer needs `GKM_SECRETS_KEY`; `gkm deploy:github`
pushes the stage's secrets to SSM with the same profile instead of setting the
key. `gkm init --deploy sst` writes the SSM store with the chosen region.

Breaking: `state: { provider: 'ssm' }` no longer carries secrets (it still
holds deploy state), and `gkm setup` no longer shares the local stage's
secrets through SSM. Move secrets to `secrets.store` and push each deployed
stage once.
