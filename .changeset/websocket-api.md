---
'@geekmidas/manifest': minor
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

`WebSocketApi`: a surface that holds long-lived connections

```ts
export const realtime = new WebSocketApi('Realtime', {
  path: 'apps/realtime',
  replicas: 2,
  messages: {
    announcement: z.object({ text: z.string() }),
    'chat.said': z.object({ from: z.string(), text: z.string() }),
  },
  logger,
}).auth(auth);

export const say = realtime
  .route('chat.say')
  .body(z.object({ text: z.string() }))
  .handle(async ({ body, connection, sockets }) =>
    sockets.broadcast('chat.said', { from: connection.id, text: body.text }),
  );

// anywhere else
router.post('/announcements').dependsOn([realtime])
  .handle(({ services }) =>
    services.realtime.broadcast('announcement', { text: '…' }),
  );
```

Frames are routed on their `action`, as API Gateway's are, with `connect()`
and `disconnect()` on the lifecycle. Anything else reaches a socket through the
surface's publisher, over Redis between processes. What it sends is declared
in `messages`: the publisher is typed by them, and each message's data is
checked by its schema before it is sent.

`gkm dev` and `gkm compose` run it as an app of its own. On compose, each
replica is a container and an upstream of the surface's route; the edge gets
the whole ephemeral port range and a million descriptors, and `gkm
compose:server` raises the kernel's conntrack table. Not yet on the AWS or
Dokploy targets.
