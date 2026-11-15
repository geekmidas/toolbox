---
'@geekmidas/cli': patch
---

A server build with an inbox subscriber includes the SNS push driver, as one
with a bucket subscriber does, whatever broker carries the app's own events.
Deployed on SES, the inbox's topic is SNS, so a worker built for pg-boss
logged `This build has no SNS driver`, reported the inbox's subscriber failed
on `/health`, and never received the inbox's mail (#518).
