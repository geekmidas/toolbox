---
'@geekmidas/cli': patch
---

`gkm dev` runs turbo through the workspace's own package manager

It spawned `pnpm turbo run dev` whatever the workspace used, so on a Yarn or
npm workspace without pnpm installed every app failed to start with
`spawn pnpm ENOENT` — after the containers, migrations and seeds had already
run. It now reads the lockfile at the workspace root, as `gkm build` does, and
runs `pnpm exec turbo`, `yarn turbo` or `npx turbo` accordingly.
