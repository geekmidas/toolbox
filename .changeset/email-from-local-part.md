---
'@geekmidas/manifest': patch
'@geekmidas/constructs': patch
'@geekmidas/cli': patch
---

`Email` names its sender's local part; the domain stays the stage's:

```ts
new Email('Mail', { templates, from: 'info' });
```

- Deployed, `MAIL_FROM` is `info@<stage domain>` — through the `ses` provider and a compose stack's Mailpit alike — and follows the stage's domain when it changes. `gkm dev`/`gkm test` send as `info@localhost`.
- `from` is a local part only: a whole address throws `EmailFromNotALocalPart`, pointing at `deploy.email.<stage>.from`, which still takes a full address and wins.
- `senderAddress(declaration, domain)` in `@geekmidas/manifest` is the one place the address is joined; `EmailDeclaration` carries `from`.
- A `MAIL_FROM` gkm wrote as `noreply@…` moves to the new local part on the next deploy. One you set by hand is kept.

Without `from`, nothing changes.
