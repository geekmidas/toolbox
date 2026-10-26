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
  environment: ['MONITORING_URL?'],
  monitoring: [{ type: 'heartbeat', provider: 'betterStack', env: 'MONITORING_URL' }],
}
```

`heartbeat.betterStack()` and `heartbeat.healthchecks()` record their provider; a custom `heartbeat()` records only its `env`, and a hand-written monitor its service name as `type`. A construct without monitors has no `monitoring` field. On the `server` provider, where one route serves the whole app, that route lists the distinct monitors across its endpoints.
