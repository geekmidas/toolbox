---
'@geekmidas/cli': minor
---

Deploy state v3: a compose shape of its own, who wrote it, and no state on a CI runner

A compose stage's state is now `provider: 'compose'` — its releases, identity
and last deploy, and none of the empty Dokploy fields it used to carry. The DNS
records gkm writes are resource records, `dns-record:<fqdn>:<type>`, written
through `recordDnsResource()` / `recordDnsChanges()` from
`deploy/dnsResources.ts`; `dnsVerified` is gone for compose, the check being made
on every deploy. Release recording and rollback work on the core every target
shares.

Every write says who made it: `updatedBy` on the document and on each resource
record, `releasedBy` on each release — a GitHub Actions run (actor, run URL,
workflow) or `user@host` — and `history` keeps the last 20 runs that wrote the
stage. `gkm state:history --stage <stage>` prints them newest first with each
app's current release (`--json` too).

State documents are schema version 3. A v2 document whose Dokploy fields are all
empty was written by compose and is read as the compose shape (its `dnsRecords`
becoming `dns-record` resources); a Dokploy document is read unchanged. Either
is written as v3 by its next write. `gkm state:push` moves a laptop's v2 state
into SSM or S3 as v3.

:boom: **A deploy or `gkm deploy:rollback` of a deployed stage now fails in CI
with `LocalStateInCi` while the workspace keeps its state locally.** The runner,
and the `.gkm/` on it, is discarded when the job ends, so the next run would
start with no releases and no record of what was created. Set
`state: { provider: 'ssm', region: '<region>' }` in `gkm.config.ts` and run
`gkm state:push --stage <stage>` from the machine that holds the state. The
local stage, and local state outside CI, are unaffected.
