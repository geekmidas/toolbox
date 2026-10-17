---
'@geekmidas/cli': minor
---

A compose worker SNS pushes to answers on a host of its own

A worker on a compose stage had no route at all, so a topic subscriber
delivered by SNS push had nowhere for SNS to reach it. When any of a worker's
topic subscribers resolves to an `sns://` connection string on a deployed
stage, the worker now answers on `<worker>.<domain>` — DNS record and
certificate included — on exactly those subscribers'
`/__gkm/subscribers/<export>` routes. Every other path is refused at the edge,
by Caddy and Traefik alike (`EdgeRoute.paths`). The worker is handed
`GKM_SUBSCRIBER_PUSH_URL` from the same route, so the address it subscribes
under is the one the edge serves. A worker whose topics are on pg-boss stays
private.

Two constructs routed to one host now fail the deploy with `EdgeHostTaken`
instead of one silently shadowing the other.
