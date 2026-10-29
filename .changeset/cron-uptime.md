---
'@geekmidas/manifest': minor
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

Crons report to an uptime monitor with `.uptime()`, which replaces `.monitor()`

**Breaking:** `.monitor()` is removed from functions, crons, endpoints and `EndpointFactory`, along with the monitor hooks in the endpoint adaptors. The manifest's `monitoring` field is removed from routes, functions and crons.

A monitor only adds something a cron can't report itself: that it didn't run. A function or endpoint runs when it's called, so no ping is ever due, and its failures are already logged where they happen. So uptime is now set on crons alone:

```ts
export const nightlyReport = c
  .schedule('cron(0 8 * * MON-FRI)')
  .uptime(heartbeat.betterStack('MONITORING_URL'))
  .handle(async () => {});
```

Calling `.uptime()` again replaces the monitor. `gkm build` records it on the cron's manifest entry as `uptime`, with the period the heartbeat should expect, derived from the schedule by `cronPeriod`:

```ts
uptime: { type: 'heartbeat', provider: 'betterStack', env: 'MONITORING_URL', period: 259200 }
```

`MonitorInfo` in `@geekmidas/manifest` is replaced by `UptimeInfo`.
