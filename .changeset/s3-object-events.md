---
'@geekmidas/cli': minor
'@geekmidas/events': patch
---

An S3 bucket's changes reach a compose worker, wired by the deploy

For each bucket a subscriber watches on a stage whose objects are on `s3`,
the deploy now creates, in the stage's account:

- an SNS topic `<bucket>-events` that only that bucket may publish to;
- a dead-letter queue `<bucket>-events-dlq` for what SNS gives up delivering;
- the bucket's notification entry `gkm-<Bucket>`, merged so that entries
  added by hand are kept;
- `<BUCKET>_EVENTS_CONNECTION_STRING`, signed by the bucket's own access key,
  whose policy gains `sns:ConfirmSubscription` on that topic alone;
- one HTTP subscription per subscriber, at
  `https://<worker>.<domain>/__gkm/subscribers/<export>`, failing over to the
  queue.

The subscription ARNs are recorded in the stage's state and handed to each
worker as `GKM_SNS_SUBSCRIPTIONS`. Once the workers are healthy, the deploy
has SNS resend any pending confirmation and waits for it. A subscription no
subscriber wants any more is unsubscribed. The GitHub deploy role gains the
SNS, SQS and bucket-notification actions this takes.

`SNSConnection` accepts a credential provider as well as static keys.
