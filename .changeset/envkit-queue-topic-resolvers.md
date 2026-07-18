---
'@geekmidas/envkit': minor
---

feat(envkit): add Queue resolver and publisher connection strings (sst)

`@geekmidas/envkit/sst` gains a `Queue` resource type (`ResourceType.Queue` /
`SSTQueue`) whose resolver emits `<NAME>_URL`, `<NAME>_ARN`, and a
`<NAME>_PUBLISHER_CONNECTION_STRING` (`sqs://?queueUrl=…`). The SNS topic
resolver now also emits `<NAME>_PUBLISHER_CONNECTION_STRING` (`sns://?topicArn=…`).

These name-namespaced connection strings are what `@geekmidas/events`'
`Publisher.fromConnectionString` consumes, so a linked queue/topic resolves to a
ready-to-use publisher (the protocol selects the transport — SQS/SNS deployed,
or a local backend in dev).
