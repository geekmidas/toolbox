## What and why

<!-- What changed, and the issue it closes. -->

## One path for every command and stage

See [AGENTS.md](../AGENTS.md#one-path-for-every-command-and-stage). Tick each, or say why it does not apply.

- [ ] Every step this adds or changes runs through **one** implementation shared by `gkm dev`, `gkm test`, `gkm exec`, `gkm seed`/`migrate`, `gkm build` and `gkm compose`; none of them has its own copy.
- [ ] What differs between commands or stages is passed **in** (ports, logins, domain, provider), not computed separately per command.
- [ ] Where a provider differs (e.g. SES vs Mailpit, SNS vs pg-boss), the difference stops at that edge; everything after it is shared.
- [ ] Every resource is created by the same rule on every target; nothing exists in one target's plan only.
- [ ] No per-construct exception to a shared rule (credentials, URL shape, env keys).
- [ ] It works on a **compose** stage, not just locally and on AWS.

## Checks

- [ ] Every affected suite is green locally (no "known" failures).
- [ ] `pnpm lint` is clean on the changed paths.
- [ ] A changeset is included where a package changes.
