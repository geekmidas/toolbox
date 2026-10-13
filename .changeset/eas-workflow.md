---
'@geekmidas/cli': minor
---

`gkm eas:sync` writes each stage's EAS workflow

`.eas/workflows/publish-<stage>.yml`, beside the app's `eas.json`, does what
`gkm publish` does using EAS Workflows' own jobs:

- `fingerprint`, then `get-build` per platform;
- an `update` on the stage's channel when a store build has the native code;
- otherwise a `build` and a `submit` with the stage's profile. iOS submits once
  its `ascAppId` is set.

It runs on a release tag for the protected stage and on `main` for the
others, or by hand with `eas workflow:run`. Shipping the app then needs nothing
in the project's own CI.

`gkm init` writes the workflows for a mobile app instead of a "Publish the app"
step in the deploy workflow. That step ran `gkm publish` on a runner with no
`eas-cli` installed, so it failed.
