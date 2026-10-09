---
"@geekmidas/cli": patch
---

Deploy state in S3 needs no bucket of yours, and a busy stage's state no longer breaks SSM

- `state: { provider: 's3', region }` with no `bucket` keeps the state in the project bucket, `gkm-<project>-<account id>`, which the first deploy (or `gkm state:push`) creates: versioned, SSE-S3, every public access blocked, bucket-owner-enforced, noncurrent versions expired after 90 days, tagged `gkm:project`. Reads never create it. A name another account holds fails with `ProjectBucketTaken`. A named bucket keeps today's behaviour.
- `gkm deploy:github` grants the CI role the project bucket's creation (exactly that name) and the stage's objects in it.
- SSM state is written with the Intelligent-Tiering tier (up to 8 KB) and stored gzipped past 3 KB; documents written before are read as they are.
- A deploy whose SSM state would not fit fails with `StateTooLargeForSsm` before anything is built or started, and a write SSM refuses is `StateRejectedBySsm`, not the SDK's `ValidationException`. Both say how to move to S3: `gkm state:pull`, switch the config, `gkm state:push`.
- `LocalStateInCi` now suggests `state: { provider: 's3', region }`.
