---
"@geekmidas/cli": minor
---

`gkm stages` prints the workspace's stages from `gkm.config.ts` (`--json` for `{"local","deployed","protected"}`), and `gkm stages --github-output` writes which stages a GitHub workflow run builds and deploys. The new `geekmidas/toolbox/actions/stages` action runs it, and the deploy workflow `gkm init` scaffolds is built on it: no stage is named and nothing parses TypeScript. `gkm init --deploy compose` scaffolds a Docker Compose server deploy: CI builds and pushes each stage's images and keeps their digests, and the deploy job resolves the release's commit and runs `gkm compose` on the server over SSH, pinned to those digests. A config without `stages` now fails with `InvalidStages`, and a config the schema refuses fails with `InvalidWorkspaceConfig`.
