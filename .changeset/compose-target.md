---
'@geekmidas/cli': minor
---

`compose` is a built-in deploy target, and the registry is `deploy.registry`

- :boom: **`deploy.dokploy.registry` is now `deploy.registry`**, read by every target. A config that still sets `deploy.dokploy.registry` fails to load with `DokployRegistryMoved`, which names the value; move it up one level: `deploy: { registry: 'ghcr.io/acme', dokploy: { endpoint: … } }`. `deploy.dokploy.registryId` stays where it is.
- **`gkm deploy --target compose --stage <stage> [--tag <tag>]`** brings a stage up as one Docker Compose stack behind Caddy, on the machine that deploys. `validate` works out the stack and, for a tag, looks up every image in the registry (`ImageTagNotFound` before anything changes); `provision` keeps the stage's generated secrets, writes the files, starts the infrastructure and applies its databases, roles, grants and migrations; `build` bundles each backend in the deploy's sandbox and builds every image, or pulls the tag; `release` runs `up --wait --remove-orphans`; `verify` asks each app through Caddy over HTTPS with the certificate verified (`ComposeAppsUnhealthy` names any that do not answer). It emits `artifact.built`, `resource.applied`, `app.deployed` and `health.checked`, and records each app's image ref, tag and digest in the stage's state under `images`, as Dokploy does (no more `compose:<app>` records). Without `--tag`, images are built and named after the commit.
- **`gkm compose` runs through it**: the same `deploy()`, with `--build`, `--pull` and `--down` on top and the local stage as its default. Its order is now infrastructure and migrations, then images, then the apps.
- **Targets**: `capabilities.localStage` lets a target that runs on this machine deploy the project's local stage (only `compose` does; every other target still refuses it with `UndeclaredStage`); a target's optional `tag()` names a run's images when no `--tag` is given; `ctx.tagGiven` says whether one was.
