---
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

Queue handlers can retry only the messages that failed

A handler now receives `records` beside `messages`: the same batch, each message with the id its transport gave it (the SQS message id deployed, a generated id under `gkm dev`). Returning `{ failed: [...ids] }` retries only those records; the rest of the batch is acknowledged.

```ts
export const ordersQueue = q
  .queue('orders')
  .message(OrderSchema)
  .handle(async ({ records, services }) => {
    const failed: string[] = [];
    for (const { id, message } of records) {
      try {
        await services.orders.fulfil(message);
      } catch {
        failed.push(id);
      }
    }
    return { failed };
  });
```

Before, a handler could only retry the whole batch by throwing, so one bad message redelivered every message that had already succeeded. Throwing still does that, and a handler that returns nothing still acknowledges the batch, so existing queues behave as before.

`TestQueueAdaptor.invoke` takes `records` as well as `messages`, to drive a handler with chosen ids. `QueueRecord`, `QueueResult` and `isQueueResult` are exported from `@geekmidas/constructs/queue`.
