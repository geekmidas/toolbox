---
'@geekmidas/cli': patch
---

A local compose stack serves its Mailpit inbox at `https://mail.<project>.localhost`

`gkm compose --stage <local>` ran Mailpit for the stack's mail but gave its web
inbox no route and no published port, so a magic link or an invite the stack
sent could not be opened. The stack's edge now routes
`mail.<project>.localhost` to Mailpit's UI, and `gkm compose` prints it with
the stack's other URLs. The route is in the stack's shared route list, which
every proxy renders from.

`mail` is reserved for the inbox on the local stage: an app whose local host
would be `mail.<project>.localhost` fails with `MailInboxHostTaken`. A deployed
stage gets no inbox route: with `--allow-dev-services`, its Mailpit stays on
the stack's network.
