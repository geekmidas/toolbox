---
'@geekmidas/cli': minor
---

✨ A deploy state store with locks, versions and per-resource records: `createStateStore` returns a `LocalStateStore` (atomic temp-file writes, `open('wx')` lock), `SSMStateStore` (create-if-absent lock, parameter-version checks) or the new `S3StateStore` (`state: { provider: 's3', bucket, region }`, `If-Match` / `If-None-Match` writes). A second run of a stage gets `StateLocked`; a write based on a stale version gets `StateVersionConflict`.

State is now stored as schema version 2. A version 1 state is migrated the first time a store reads it, and the original is kept as `.gkm/deploy-<stage>.v1.json` (`state.v1` beside the SSM parameter, `state.v1.json` beside the S3 object). Local state files are mode 0600, `gkm state:show` masks database passwords, generated secrets and IAM keys, and `gkm state:unlock --stage <stage>` releases a lock a crashed run left behind. A custom `StateProvider` keeps working but warns `StateStoreWithoutLocking`; `CachedStateProvider` is deprecated for deploys.
