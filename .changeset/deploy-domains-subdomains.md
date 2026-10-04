---
'@geekmidas/cli': minor
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
---

:boom: `deploy.domains` for every target, a `subdomain` on each surface, and each `RestApi` on its own host

- **`deploy.dokploy.domains` is now `deploy.domains`.** A stage's base domain is a fact about the deployment, not about Dokploy, so every target reads it. Move the block up one level: `deploy: { domains: { production: 'myapp.com' }, dokploy: { endpoint, registry } }`. A stage with no domain fails with `NoDomainForStage`, naming the stage and where to add it.
- **`subdomain` on `RestApi`, `BetterAuth` and `StaticSite`.** A surface answers on `{subdomain}.{domain}` — `new RestApi('Api', { path: 'apps/api', subdomain: 'v1' })` is `v1.myapp.com` — and on the same label locally, `v1.shop.localhost`. Absent, the id kebab-cased, as before.
- **Each `RestApi` on its own host.** A deploy handed every surface the first backend's address, so a workspace with two APIs pointed both at one. Each now gets its own app's URL.
