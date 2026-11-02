---
'@geekmidas/constructs': minor
---

:sparkles: A `WebSocketApi` can speak flat frames — `frame: { discriminator: 'type' }` — and trusts its own origin

- **`frame: { discriminator }`** makes the surface's frames flat both ways: outbound `{ [discriminator]: action, ...data }` (data still checked by the action's schema first), inbound routed on the same key with every other field as the body, and `$error` replies in the same shape. Absent, frames stay `{ action, data }`. `send(ids, action, data)` is typed the same in both modes, and `realtime.frame` exposes the shape for a client to decode by.
- **Refused when the surface is built:** with a discriminator, a message schema that isn't an object throws `WebSocketMessageNotAnObject`, and one that declares the discriminator field throws `WebSocketMessageDeclaresDiscriminator`. A surface without `messages` checks at send time (`WebSocketDataNotAnObject`, `WebSocketDataHasDiscriminator`).
- **The surface trusts the origin of its own address** (`<ID>_URL`), as well as `<ID>_TRUSTED_ORIGINS`: React Native's `WebSocket` sends the socket's own origin (`https://` for `wss://`) as `Origin`, which was refused with 403.
