---
'@geekmidas/cli': minor
---

`gkm publish --stage <stage>` ships a mobile app for a deployed stage

It syncs the app's EAS project (as `gkm eas:sync`), then, per platform,
chooses the cheapest release:

- an **update** on the stage's channel when a finished store build of the
  stage's profile has the same native fingerprint, so only JavaScript changed;
- otherwise a **store build** with `--auto-submit`. Android goes to the
  stage's Play track. iOS is submitted once `submit.<stage>.ios.ascAppId` is
  set, and is built without submitting until then.

`--build` and `--update` force either choice. `--update` with no store build
to receive it is refused (`NoStoreBuildForUpdate`).

`gkm init`'s deploy workflow publishes the app after a stage's servers when
the workspace has one (`EXPO_TOKEN` on the stage's environment). Its
`eas.json` now has one store profile per deployed stage (environment,
channel, Play track) and no URLs. URLs in `eas.json`'s `env` would override
the values `gkm eas:sync` sets.
