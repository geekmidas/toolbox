---
'@geekmidas/cli': minor
---

Every Next.js build gkm runs gets a deployment id and a stable server actions key (#508)

A deploy that replaced a Next site's container left tabs opened before it
asking for chunks that no longer existed ("This page couldn't load") and
submitting server actions the new build could not find. Now:

- `NEXT_DEPLOYMENT_ID` is the release — the image's `<tag>-<stage>` on a
  server stage, the deploy's tag on SST — so Next does a full page load when an
  old tab navigates, with no `deploymentId` in `next.config`.
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is generated once per stage on its first
  deploy, kept in the stage's secrets, never rotated by a deploy, and handed to
  a Next site's build and its server — no other app.
