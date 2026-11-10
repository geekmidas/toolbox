---
'@geekmidas/events': minor
'@geekmidas/constructs': minor
---

FIFO queues can be published to, with a message group per message

`q(...).fifo({ groupId })` gives each message its FIFO group, and the queue's `publisher` sends it as `MessageGroupId`. Before, the SQS publisher set no group, so publishing to a FIFO queue was refused. Messages in one group keep their order; different groups are processed in parallel.

```ts
export const conversationQueue = q
  .queue('processConversation')
  .message(ConversationEventSchema)
  .fifo({ groupId: (message) => message.conversationId })
  .handle(async ({ records }) => { … });
```

Underneath, `SQSPublisherOptions.groupId` and the new `PublisherOptions` argument to `Publisher.fromConnectionString` carry it; other transports ignore it. The queue must use content-based deduplication, since no deduplication id is sent. `.fifo()` and `.fifo(true)` work as before.
