---
'@geekmidas/constructs': patch
'@geekmidas/envkit': patch
'@geekmidas/emailkit': patch
'@geekmidas/client': patch
'@geekmidas/schema': patch
'@geekmidas/storage': patch
'@geekmidas/telescope': patch
'@geekmidas/testkit': patch
'@geekmidas/db': patch
'@geekmidas/cli': patch
---

Dependency changes that let consumers clear security advisories

- **constructs, envkit**: no longer depend on `lodash.pick` and `lodash.set` (GHSA-p6mc-m468-83gw, no fixed release). Native code does the same work, and constructs no longer bundles either module into its dist.
- **emailkit**: `nodemailer` ^6.9.7 → ^7.0.7. emailkit only uses the SMTP transport, which v7 leaves unchanged.
- **envkit, client, schema, storage**: the `zod` peer range widens from `~4.1.13` to `^4.1.13`, so apps can move to zod 4.6.6 (GHSA-mrhx-c7xc-m3w5).
  - The OpenAPI client generator no longer emits `export type User = User` for an endpoint whose output is a registered schema, which zod 4.6 started producing.
- **telescope**: the OpenTelemetry peers accept the 2.x line (`@opentelemetry/sdk-trace-node` ^2 and the matching 0.2xx packages) as well as 1.x. This clears GHSA-45rx-2jwx-cxfr and GHSA-8988-4f7v-96qf.
  - `setupTelemetry` works on both lines.
  - Its log records are now exported through the SDK. Before, they went to a logger provider that was never registered.
- **testkit, db**: `@faker-js/faker` ~9.9.0 → ^10.4.1 (GHSA-qxc2-j82w-r537), and the `vitest` peer accepts `^3.2.4 || ^4.1.11`.
  - `@geekmidas/testkit/faker` extends faker, so faker 10's removed APIs apply to it.
  - faker 10 is ESM-only. It needs Node 22.13 or later, its own minimum, and loading testkit from CommonJS relies on that version's `require()` of ES modules.
