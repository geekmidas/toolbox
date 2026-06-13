---
'@geekmidas/cloud': minor
---

feat(cloud): add Queue and Topic linkable constructs

`Queue` (wraps `sst.aws.Queue`) and `Topic` (wraps `sst.aws.SnsTopic`) are
linkable messaging resources. Linking one to a producer resolves a
name-namespaced `<NAME>_PUBLISHER_CONNECTION_STRING` (plus `<NAME>_URL`/`_ARN`)
that `@geekmidas/events`'s `Publisher.fromConnectionString` consumes. `Queue`
overrides `getSSTLink` to also expose `arn` (SST's native link exposes only
`url`). `QueueProps`/`TopicProps` extend the native `QueueArgs`/`SnsTopicArgs`.
