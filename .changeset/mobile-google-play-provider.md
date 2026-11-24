---
'@geekmidas/cli': minor
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
---

A `MobileApp` sets itself up on Google Play through `gkm deploy`

- **`deploy.mobile.<stage>: { provider: 'google-play', developer }`.** Every deploy of the stage makes what EAS Submit needs to publish each `MobileApp` to Google Play: the Google Cloud project (`--project`, else `deploy.mobile.<stage>.project`, else `<workspace>-play`) with the Android Publisher API on, the service account, its grant on each app alone (permissions following every Play stage's track), the key EAS Submit uses, and the store listing from `store/play/` when it changed.
- **The construct says how Play and EAS know it**: `new MobileApp('App', { path, android: { package }, eas: { projectId } })`. A Play stage whose app says neither stops with `MobileAppStoreIdentityMissing`.
- **The key is kept while it works.** A deploy issues one only when EAS submits with none of the account's live keys, or with `--rotate-keys`; it is proved on every app before the older keys are deleted from EAS and Google. One key serves every app.
- **An app not in Play Console yet is pending, not failed.** The deploy says what to create; at a terminal it waits for it. Until the app's first upload, the deploy names the newest EAS store build's `.aab`.
- **From CI the deploy only checks**: it finds EAS's key among the account's live keys, and leaves a missing one pending. `--rotate-keys` there is `PlaySetupNeedsPerson`. The generated deploy workflow passes `EXPO_TOKEN`.
- **`gkm publish`** refuses an Android store build on a Play stage while EAS holds no key to submit it with (`PlaySubmitKeyMissing`).
- :boom: **`gkm deploy:google-play` is removed**: set `deploy.mobile.<stage>` and deploy the stage.
