---
'@geekmidas/cli': patch
---

One unhealthy app no longer leaves the whole compose stack unrouted

`gkm compose` and `gkm deploy --target compose` wrote a stack's routes into
the shared Traefik edge only after `docker compose up --wait` succeeded, and
Caddy waited for every app to be healthy before it started. So one app that
failed its health check left every host without a route, the healthy ones
included. A site whose own health check calls its API through the edge could
never turn healthy at all.

- The stack's routes are registered with the shared edge before anything
  waits on health. A route to an app that is not up answers 502.
- Caddy starts once its apps have started (`condition: service_started`)
  and checks each upstream itself (`health_uri`, every 5s), as the Traefik
  routes already do with `loadBalancer.healthCheck`.
- An app or worker that never turns healthy still fails the release with
  `ComposeAppsUnhealthy`, naming it, but only after the rest of the stack is
  released and routed.
