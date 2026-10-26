---
'@geekmidas/constructs': minor
---

Functions, crons and endpoints can report their runs to a monitor

`.monitor(service)` tells a monitor when a run starts, succeeds or fails: a heartbeat, an uptime check, an error tracker. It can be called more than once, and a monitor set on a shared base or on an `EndpointFactory` is inherited by everything built from it. A monitor that fails is logged and never fails the run.

`heartbeat()` from `@geekmidas/constructs/monitors` pings a URL read from an environment variable, `HEARTBEAT_URL` by default. When the variable is unset it does nothing, so only the stages that set it are monitored. Presets cover Better Stack and Healthchecks.io:

```ts
import { heartbeat } from '@geekmidas/constructs/monitors';

export const nightly = c
  .schedule('rate(1 day)')
  .monitor(heartbeat.betterStack('NIGHTLY_HEARTBEAT_URL'))
  .handle(async () => {});
```

Endpoints report from the response status: a 5xx is a failure and anything else, including a 4xx, is a success. On Lambda the report is awaited before the response returns; on Hono it is not, so requests do not wait on the monitoring service.
