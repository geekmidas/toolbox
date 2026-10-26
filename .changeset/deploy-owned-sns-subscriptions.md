---
'@geekmidas/events': minor
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

Against SNS itself, the deploy owns a server's push subscriptions

A server subscribed its own routes to SNS at startup and confirmed each by
visiting its `SubscribeURL`. That needed `sns:Subscribe`, `Unsubscribe` and
`SetSubscriptionAttributes` at runtime, and a subscription confirmed that way
can be removed by anyone holding the `UnsubscribeURL` every notification
carries.

**Behaviour change:** against SNS itself (an `sns://` string with no
`endpoint`), a server no longer subscribes anything. It mounts a subscriber's
route only when `GKM_SNS_SUBSCRIPTIONS` — a JSON object of subscriber export →
subscription ARN, handed over by the deploy — has one for it; a subscriber
without one is logged and reported as failed. Confirmations go through the
`ConfirmSubscription` API with `AuthenticateOnUnsubscribe`, so only the
topic's owner can unsubscribe a route, and the runtime needs only
`sns:ConfirmSubscription` on its topic. A notification whose
`x-amz-sns-subscription-arn` header names another subscription is refused
(defence in depth: SNS does not sign its headers). Against an emulator nothing
changes: the server still subscribes itself.

- `@geekmidas/events/sns`: `reconcileHttpSubscriptions(connection, { endpoints,
  ownedHost })` converges a topic's HTTP subscriptions for a deploy and answers
  `{ subscriptions, pending, removed }`. ARNs are answered while still pending
  and stay stable across runs, and a re-run resends pending confirmations. It
  also removes this host's subscriptions that are no longer wanted.
  `confirmSubscription(connection, message)` confirms as the topic owner.
  `subscribeHttpEndpoint` and the reconciler take an explicit `filterPolicy`
  and `filterPolicyScope` (`MessageBody` for messages with no `type`
  attribute).
- `@geekmidas/constructs/subscribers`: `SnsPushSubscriberAdaptor` takes
  `subscriptionArn` and a `confirm` hook, and `handle(body, { subscriptionArn })`.
- `gkm compose`: a worker SNS pushes to is handed `GKM_SNS_SUBSCRIPTIONS` from
  the stack's new `pushSubscriptions` input in place of
  `GKM_SUBSCRIBER_PUSH_URL`, and a pushed subscriber without a recorded ARN
  fails with `PushSubscriptionMissing`.
