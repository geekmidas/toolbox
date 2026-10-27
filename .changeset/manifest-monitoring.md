---
'@geekmidas/manifest': minor
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

The manifest records each construct's monitors

Functions, crons and routes set with `.monitor()` now carry a `monitoring` list in the build manifest, so infrastructure can provision what they report to without reading the code:

```ts
{
  name: 'nightlySync',
  schedule: 'cron(0 8 * * ? *)',
  environment: ['MONITORING_URL'],
  monitoring: [{ type: 'heartbeat', provider: 'betterStack', env: 'MONITORING_URL' }],
}
```

`heartbeat.betterStack()` and `heartbeat.healthchecks()` record their provider; a custom `heartbeat()` records only its `env`, and a hand-written monitor its service name as `type`. A construct without monitors has no `monitoring` field. On the `server` provider, where one route serves the whole app, that route lists the distinct monitors across its endpoints.

A heartbeat's URL variable is now required rather than optional, so the manifest lists it as `MONITORING_URL` instead of `MONITORING_URL?` and a deploy that does not set it is caught. If it is still missing at runtime, the monitor is skipped with a warning and the run goes on.
