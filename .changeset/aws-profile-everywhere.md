---
'@geekmidas/cli': minor
---

Every command that reaches AWS takes `--profile`, and honours it end to end

`deploy`, `deploy:rollback`, `compose` (deploying, `--down` and `--destroy`), `compose:server`, `build --stage`, `test --stage`, `backup:now`, every `secrets:*` command, `encryption:rotate`/`retire` and every `state:*` command now take `--profile <name>`, so the stage's account no longer has to be picked with `AWS_PROFILE`. The profile is used alone — over `AWS_PROFILE` and exported `AWS_*` keys — for every AWS client the command makes: the stage's secrets and state stores, the providers a deploy runs, its backups, SNS subscriptions, Route 53 records and ACME keys, and the AWS credential the `sst` target hands `sst deploy` — its `gkm build` step is passed the profile by name, never keys. It also wins over a profile `gkm.config.ts` names (`state.profile`, a Route 53 entry's, Dokploy backups'), so one flag picks one account. `backup:list` and `backup:restore` now read the stage's secrets with their `--profile` too, not only S3.
