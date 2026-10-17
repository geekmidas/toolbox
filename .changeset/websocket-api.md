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
  logger,
}).auth(auth);

export const say = realtime
  .route('chat.say')
  .body(z.object({ text: z.string() }))
  .handle(async ({ body, sockets }) => sockets.broadcast(body));

// anywhere else
router.post('/announcements').dependsOn([realtime])
  .handle(({ services }) => services.realtime.broadcast({ … }));
```

Frames are routed on their `action`, as API Gateway's are, with `connect()`
and `disconnect()` on the lifecycle. Anything else reaches a socket through the
surface's publisher, over Redis between processes.

`gkm dev` and `gkm compose` run it as an app of its own. On compose, each
replica is a container and an upstream of the surface's route; the edge gets
the whole ephemeral port range and a million descriptors, and `gkm
compose:server` raises the kernel's conntrack table. Not yet on the AWS or
Dokploy targets.
