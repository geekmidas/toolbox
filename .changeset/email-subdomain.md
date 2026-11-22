---
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
'@geekmidas/cli': minor
---

`Email` takes a `subdomain`: the label of the stage's domain the application sends mail from. `new Email('Mail', { templates, from: 'info', subdomain: 'mail' })` sends as `info@mail.<stage domain>` (`info@mail.localhost` locally). With `deploy.email: { provider: 'ses' }` the deploy verifies `mail.<stage domain>` as the SES identity and writes its DKIM records under it, so the bare domain's own mail setup is left alone. `senderDomain` in `@geekmidas/manifest` is the one place the sending domain is derived.
