---
'@geekmidas/cli': minor
---

`gkm secrets:add` walks the stage's keys as checkpoints, unset ones first:
at each, **Set it now**, **Skip** or **Stop here**. A key is saved to the
stage's store as soon as it is built, so stopping, Ctrl-C or a failure keeps
everything set before it, and the run ends with what was saved, skipped and
still missing — `--missing` picks up the rest. A key a provider on the stage
creates (a bucket under `deploy.objects.<stage>`, written by `gkm setup`) is
no longer offered: it is listed with what creates it, and marked
`"provisioned": true` in `--json`. Mail asks for the service first — Resend,
Amazon SES, Postmark and Mailgun ask only for their secrets.
