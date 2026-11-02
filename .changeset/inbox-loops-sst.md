---
'@geekmidas/emailkit': minor
'@geekmidas/constructs': minor
'@geekmidas/testkit': minor
'@geekmidas/envkit': minor
'@geekmidas/cloud': minor
'@geekmidas/cli': minor
---

:sparkles: An inbox no longer answers its own replies, and it deploys through SST

**Reply loops.** Without this, a handler that replies to mail can end up answering its own replies, through a forged `From:` or someone's out-of-office. It now follows RFC 3834:

- Mail sent while an inbox handler runs is marked `Auto-Submitted: auto-replied`.
- Mail that arrives with `Auto-Submitted` set to anything but `no` is dropped before the handler sees it.
- `worker.inbox(inbox).automated()` hands that mail to the handler instead.

emailkit exports `autoReplying`, `isAutoSubmitted` and `AUTO_SUBMITTED_HEADER`. testkit's `Email` now has `headers`.

**SST.** An app with an inbox deploys through `gkm deploy --target sst`:

- The `ses` provider creates the bucket, topic, rule and DNS records, as on compose.
- `gkm deploy` hands `sst deploy` the inbox's values from the stage's secrets.
- `fromManifest` references the provider's topic instead of creating one, and subscribes the inbox's Lambda to it.
- envkit resolves the new `gkm:aws:Inbox` link to `<ID>_URL` and `<ID>_DOMAIN`.
