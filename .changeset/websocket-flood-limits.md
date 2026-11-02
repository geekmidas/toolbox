---
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
'@geekmidas/cli': minor
---

WebSocketApi: limits on handshake, connection and inbound-frame floods

A `WebSocketApi` now bounds what one client may ask of it, on by default:

| Limit | Default | Past it |
|---|---|---|
| `handshakesPerMinute`, per client address | 120 | 429 with `Retry-After`, before the connect handler runs |
| `inFlightHandshakes`, per client address | 16 | 429 |
| `connectionsPerIp` | 256 | 429 |
| `messagesPerSecond` + `burst`, per socket | 50, 100 | one `$error`, then close 1008 |
| `maxConnections` per `maxConnectionsPer(data)` | 16, opt-in | 429, or `overflow: 'closeOldest'` closes the oldest with 1008 |

On the Redis transport the counts live in the publisher's Redis, so every
limit holds across replicas. Set a limit to `false` to lift it.
`requireOrigin: true` refuses an upgrade that sends no `Origin` with 403.

The surface declares its per-address limits in the manifest, and
`gkm compose` renders them on the shared Traefik as `rateLimit` and
`inFlightReq` middlewares on its route. Caddy has no rate limiter, so behind
it the surface's own count is what holds.

**Behaviour change:** a client past a default limit is now refused. Raise or
lift the limit on a surface that legitimately needs more, for example many
clients behind one NAT (`connectionsPerIp`) or a chatty socket
(`messagesPerSecond`).
