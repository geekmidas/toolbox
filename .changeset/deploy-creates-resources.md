---
'@geekmidas/cli': minor
---

:sparkles: **The deploy creates the stage's resources — buckets, keys, DNS records; `gkm setup` is local only.**
`gkm deploy --stage <stage>` (and `gkm compose --stage <stage>`, the same
deploy) now creates everything a deployed stage needs, every run, before its
checks:

- **Providers.** Each `deploy.<kind>.<stage>` provider runs its `ensure()` —
  for `objects: { provider: 's3' }`, the bucket (adopted when it is already
  there), its IAM user and key — and writes the keys into the stage's secrets
  before `ExternalServicesNotConfigured` is checked, so a key the deploy
  creates is never reported missing. No provisioning credentials stops the
  deploy with `ProviderCredentialsMissing`, saying what it needs locally and in
  CI. `--rotate-keys` and `--retire-old-keys` moved to the deploy; the next
  deploy after a rotation deletes the old key.
- **DNS.** With a provider for the stage's domain in `dns`, the deploy writes
  the stage's missing or out-of-date records itself — one per public host,
  never a wildcard (`DnsWildcardRefused`), only A/AAAA/CNAME of the stage's own
  hosts — and confirms what it wrote by reading it back from the provider
  (`DnsRecordsNotConfirmed`), not by a public lookup a brand-new name could be
  cached as missing in. A new app's record is created by its first deploy.
  `manual` domains and hosts under no `dns` domain keep the public-lookup check.
  A GoDaddy or Hostinger domain with no token fails the deploy at its start
  with `DnsCredentialMissing`, naming the key and the GitHub environment secret
  it belongs in. What the deploy writes is recorded in the stage's state as
  `dns-record` resources (`dnsResourceKey(fqdn, type)`).
- **Flags**, on `gkm deploy` and `gkm compose` alike: `--skip-dns` (replaces
  `--skip-dns-check`; writes and checks nothing), `--resources-only` (create
  the stage's resources and nothing else — what a CI runner runs),
  `--skip-resources` (an earlier `--resources-only` run created them), and a
  `--dry-run` that prints the providers' and the records' plan.
- **CI.** The scaffolded compose workflow creates the resources on the runner
  (`gkm deploy --stage <stage> --resources-only`, with the stage's AWS role and
  `GODADDY_API_TOKEN`/`HOSTINGER_API_TOKEN` from its environment) and runs the
  server's `gkm compose` with `--skip-resources`, so neither the cloud
  credentials nor the DNS token reach the server. The stages action has a new
  `resources` output naming those stages. `gkm deploy:github`'s scoped role
  now allows the s3 provider's buckets and IAM users, by their names, and the
  stage's Route53 zone, only when the stage uses them.

`gkm setup` is the one-time local step: the local stage's secrets and
containers. `gkm setup --stage <deployed stage>` fails with `SetupIsLocal`;
its `--dry-run`, `--profile`, `--rotate-keys` and `--retire-old-keys` are gone.
