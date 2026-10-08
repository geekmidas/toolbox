---
'@geekmidas/cli': patch
---

:bug: A site's image generates the API client it imports, and its build can run through `gkm exec`

`gkm compose --build` (and every image `gkm docker` writes) could not build a site that imports the typed client gkm generates (`@<name>/client/<surface>`): the client lives in the workspace root's `.gkm/client/`, which `.dockerignore` keeps out of every build context, and nothing generated it in the image — `next build` failed with `Cannot find module '<scope>/client/api'`, and a `gkm exec -- next build` script found no config or constructs.

- **A site's image carries the gkm workspace**, as a backend's does: the config and the construct directories (sources only), the workspace's own package when nested in a monorepo, and the package of each backend the site depends on.
- **The client is generated inside the builder**, before the site is built: `gkm openapi --app <backend>` for each backend the site depends on, written where the site's tsconfig paths expect it. Offline — no secret, no stage, no container. Nothing generated on the host is copied in.
- **`gkm` is on the builder's `PATH`**, resolved from the workspace, so a site build script that is `gkm exec -- next build` runs in the image. There `GKM_IMAGE_BUILD=1` makes `gkm exec` inject only the public build args (`NEXT_PUBLIC_*`, `VITE_*`, `EXPO_PUBLIC_*`) — never a stage's secrets, and never the `localhost` URLs a workspace resolves on a developer's machine. Sites build with `turbo run build --env-mode=loose` so those values reach the task.
- **`gkm openapi --app <name>` reads endpoints through the workspace's constructs globs**, as `gkm build` does, instead of importing every `.ts` under the app — which loaded its tests and gkm's generated test harness, and failed.
