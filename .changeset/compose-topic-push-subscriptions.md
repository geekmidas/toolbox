---
'@geekmidas/cli': patch
---

A compose deploy subscribes a hand-set SNS topic's subscribers

Since the deploy owns SNS push subscriptions, a worker never subscribes itself
against SNS — and a compose stage whose topic secret
(`<TOPIC>_PUBLISHER_CONNECTION_STRING`) names a real SNS topic had nobody to
subscribe its routes, so the stack refused to compose with
`PushSubscriptionMissing`. The compose deploy now does it, in `provision`,
before a file is written: one subscription per subscriber at its route on the
worker's host, filtered on the event types it names, signed with the keys in
the topic's string (or the deploy's own AWS credentials when it carries none).
Each ARN is recorded in the stage's state and handed to the worker; a removed
subscriber's subscription is unsubscribed and forgotten, pointing the secret at
another topic moves them, and pending confirmations are resent once the
workers are up, as a bucket's are. A dry run lists them.

The recorded-subscription helpers the `s3` provider and the compose target
share moved to `deploy/snsSubscriptions.ts`.
