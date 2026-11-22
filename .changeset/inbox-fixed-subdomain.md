---
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
'@geekmidas/cli': minor
---

`Inbox` takes `subdomain: 'in'` to receive at `<address>@in.<domain>`. The deploy verifies `in.<domain>` with SES and writes its MX only, so the apex's MX stays with the team's own mail provider. `<ID>_DOMAIN` (and `InboxClient.domain`) is `in.<domain>` on every stage, `in.<project>.localhost` under `gkm dev`. `subdomain` beside `subdomains: true` is refused at construction with `InboxSubdomainConflict`.
