---
"@geekmidas/cli": minor
---

`gkm compose --stage <stage> --build --check` starts every image the build produced before anything is pushed. Each image runs on the building machine with the stage's real secrets and the stack's backing services (migrated, not seeded) and must pass its own health check. An image that does not start fails with `StartupCheckFailed`, which names the container and shows its last log lines, and nothing is pushed. With `--push`, the images are pushed only after every one passes. The stage must be deployed and not protected (`StartupCheckNeedsDeployedStage`, `StartupCheckStageProtected`). The new `geekmidas/toolbox/actions/startup-check` action runs the check from a workflow. The deploy workflow that `gkm init --deploy compose` scaffolds now runs `--check` in its build job for every stage that is not protected.
