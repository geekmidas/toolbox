---
'@geekmidas/cli': minor
---

Every app image is built inside Docker, from a pruned slice of the build root

`gkm docker`, `gkm compose` (and `--target compose`) and the Dokploy target now generate the same Dockerfiles and build them the same way: `turbo prune` cuts the app's slice of the repository, the image installs it, builds the workspace packages it depends on, and builds the app — `gkm build --provider server --production` for a backend, the framework's build for a site. Nothing is built on the host first, and `docker build` on a clean checkout is all an image needs.

- The build context is the build root: the directory holding the lockfile or `pnpm-workspace.yaml` at or above the gkm workspace. In a project of its own that is the workspace's root; a gkm workspace nested in a monorepo is built from the monorepo's root, with every path in its Dockerfiles relative to it.
- The build root's `.dockerignore` is created, or has the missing lines appended, so no context holds `node_modules`, `.git`, anything built on the host (`dist`, `.next`, `.gkm`), or a stack's env files under `.gkm/compose`.
- pnpm, yarn, npm and bun are pinned to the build root's `packageManager`, and turbo to the version it resolves (its lockfile or installed copy; a constant in the CLI when it has none).
- A backend's encrypted credentials reach the image as the `gkm_credentials` BuildKit secret, and are now embedded: the bundle reads them, and a `GKM_CIPHERTEXT_HASH` build arg rebuilds the layer when they change. `gkm compose` builds each backend with its environment this way, its env file holding the `GKM_MASTER_KEY`.
- A Next.js image fails its build, saying so, when `output: 'standalone'` is missing.
- `gkm build --stage` embedded its credentials quoted twice, so they never decrypted; they decrypt now.

:boom: `gkm compose` no longer bundles backends on the host: each is bundled in its image. `gkm docker --slim`, `--turbo` and `--turbo-package`, and `gkm prepack --slim` / `--skip-bundle`, are gone.

:boom: A Vite site's image serves its files with Caddy (`caddy:2.10-alpine`, as a non-root user) instead of nginx: hashed `/assets/*` are `Cache-Control: public, max-age=31536000, immutable`, everything else — `index.html` and every client-side route that falls back to it — `no-cache`.
