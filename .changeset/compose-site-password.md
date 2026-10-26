---
'@geekmidas/cli': minor
---

A compose stage's sites can be put behind a password

`deploy.sitePassword` names the deployed stages whose sites ask for a login before anything loads: `true` for every site, or a list of the ones to protect.

```ts
deploy: {
  sitePassword: { staging: true, preview: ['web'] },
}
```

The edge asks with HTTP basic auth, with Caddy's `basic_auth` or a Traefik `basicAuth` middleware on the shared edge. The user is the stage's name. The password is generated once per site into the stage's secrets as `<SITE>_SITE_PASSWORD`, and one set by hand wins. Only its bcrypt hash reaches the edge's config, and its salt is derived from the password, so a deploy that changed nothing renders the same edge.

The keys are typed from `stages.deployed`, and the config check refuses an unknown stage or the local one. A name that is not a site fails with `UnknownPasswordSite`. The deploy's health check signs in with the login, and the summary says where to read the password: `gkm secrets:show --stage <stage> --reveal`. Dokploy and AWS don't support it yet. A stage it names that deploys through either fails with `SitePasswordNeedsCompose` before anything is deployed, rather than being served publicly.
