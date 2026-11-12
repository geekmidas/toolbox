---
'@geekmidas/cli': patch
---

A deploy subscribes the workers' routes to an SES inbox's topic with its own
AWS credentials, as it does a watched bucket's. It used the key in the topic's
connection string, which is the inbox's IAM user's and may only confirm a
subscription, so `gkm deploy` failed with `AuthorizationErrorException` on
`SNS:ListSubscriptionsByTopic` and the inbox's mail never reached the worker.
The app's key stays limited to `sns:ConfirmSubscription`. Any topic the stage's
providers made is treated the same way, including when a pending confirmation
is resent after the workers are up.
