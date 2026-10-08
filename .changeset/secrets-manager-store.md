---
'@geekmidas/cli': minor
---

:sparkles: Secrets Manager as a secrets store, and SSM stages past 4 KB

- `secrets.store: { provider: 'secrets-manager', region, kmsKeyId? }` keeps each deployed stage in one AWS Secrets Manager secret, `gkm/<project>/<stage>/secrets`, holding the same JSON as the SSM parameter: up to 64 KB, encrypted with `aws/secretsmanager` or the key given. Every `secrets:*` command, `gkm setup`, `build`, `exec` and every deploy target read and write it as they do SSM, with the same `AWS_PROFILE` / `--profile` handling.
- The SSM store writes in the Intelligent-Tiering tier, so a stage between 4 KB and 8 KB (a service-account JSON key, say) is accepted instead of failing with `ValidationException`. It stays free under 4 KB.
- A stage too large for its store — 8 KB for SSM, 64 KB for Secrets Manager — fails with `StageSecretsTooLarge` (stage, store, bytes, limit) before AWS is called; on SSM it points at Secrets Manager.
- `gkm secrets:migrate --stage <stage> --to <file|ssm|secrets-manager>` copies a deployed stage, whole, from the configured store to another.
- A `secrets.store` provider name gkm does not ship fails with `UnknownSecretsStoreProvider`, never falling back to the file.
