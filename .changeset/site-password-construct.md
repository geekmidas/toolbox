---
'@geekmidas/cli': minor
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
---

A site's password is a `RandomPassword` it names, on the stages it names

`deploy.sitePassword` is gone. A `StaticSite` now takes a `RandomPassword` and the stages it guards, so the password is generated, kept, revealed and set like every other one:

```ts
export const sitePassword = new RandomPassword('SitePassword');

export const web = new StaticSite('Web', {
  path: 'apps/web',
  password: { secret: sitePassword, stages: ['staging'] },
});
```

On compose, the edge asks for it with HTTP basic auth, with Caddy's `basic_auth` or a Traefik `basicAuth` middleware on the shared edge. The user is the stage's name and the password is the `RandomPassword`'s value on that stage, generated on the first deploy and kept like any other, under the site's key `SITE_PASSWORD`. One set by hand wins. A password generated for the old `<SITE>_SITE_PASSWORD` key is not carried over. Only its bcrypt hash reaches the edge's config, and its salt is derived from the password, so a deploy that changed nothing renders the same edge.

The stages are typed from `stages.deployed`, and a deploy refuses one the workspace doesn't deploy (`UnknownPasswordStage`) or a `RandomPassword` that wasn't exported (`SitePasswordNotDeclared`). The deploy's health check signs in with the login, and the summary says where to read the password: `gkm secrets:show --stage <stage> --reveal`. Dokploy and AWS don't support it yet. A site behind a password on a stage that deploys through either fails with `SitePasswordNeedsCompose` before anything is deployed, rather than being served publicly.
