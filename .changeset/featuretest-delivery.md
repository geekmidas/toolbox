---
'@geekmidas/constructs': minor
'@geekmidas/cli': patch
---

:sparkles: `featureTest` delivers what a test publishes to its consumers, end to end without a broker (#115)

Once each request a test makes has answered, what it published reaches the consumers that would receive it deployed: a queue's messages its one consumer, a topic's events every subscriber that named them, and only those. Each payload is checked against the consumer's schema first (`MessageRejected`); consumers run in the test's transaction, so they see the endpoint's rows and their writes roll back; what they publish is delivered in turn until nothing is left (`DeliveryDidNotSettle`); and a consumer that throws fails the test (`DeliveryFailed`). `published(...)` still records, and `queue(q).invoke()` / `subscriber(s).invoke()` deliver what they publish too.

`gkm test` now records each topic subscriber in the test manifest (`subscribers`).
