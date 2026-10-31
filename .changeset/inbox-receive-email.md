---
'@geekmidas/manifest': minor
'@geekmidas/constructs': minor
'@geekmidas/emailkit': minor
'@geekmidas/testkit': minor
'@geekmidas/cli': minor
---

:sparkles: Receive email: an `Inbox` construct, handled in a worker

`new Inbox('Requests', { addresses: ['requests'], subdomains: true })` receives
mail at `requests@<tenant>.<stage domain>` (and `requests+<tag>@`), and
`worker.inbox(inbox).handle(({ messages }) => …)` is handed each message,
parsed, with its envelope recipient taken apart (`subdomain`, `tag`) and the
provider's verdicts. Routing is by the envelope, never `From:`/`To:`.

- One receiver for every local path: Mailpit's webhook calls the worker's
  `/__gkm/inbox` route under `gkm dev` and a local compose stack, and
  `mailbox.receive({ to, from, … })` / `mailbox.receive({ to, raw })` in a
  feature test. The handler reads the raw message back from Mailpit.
- `deploy.inbox.<stage> = { provider: 'ses' }`: the deploy creates each inbox's
  own bucket and SNS topic, the domain's SES identity (DKIM) and MX records
  through the stage's DNS, and a receipt rule in the region's active rule
  set; SNS pushes to the worker over HTTPS. A removed inbox's rule is deleted.
- `@geekmidas/emailkit/inbound`: `parseEmail`, `composeEmail`, `deliverRaw`
  (postal-mime). The testkit mailbox now parses with it, so attachments
  survive (#315).
- The stage DNS step writes MX records on Route53, GoDaddy and Hostinger.
  Hostinger updates now replace a record set instead of appending to it, and
  GoDaddy accepts a `*` record at a zone's root.
