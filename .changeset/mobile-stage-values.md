---
'@geekmidas/cli': minor
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
---

A mobile app's values for a deployed stage reach EAS: `gkm eas:sync`, and `gkm exec --stage` from a mobile app

A store build runs on EAS's machines, outside gkm, so until now a deployed
stage's API and auth URLs had to be copied into EAS by hand.

- `gkm eas:sync --stage <stage>` writes the stage's `build.<stage>` profile
  (EAS environment and channel) and `submit.<stage>.android` profile (Play
  track and release status) into the app's `eas.json`. Every other field is
  kept. It then sets the app's values for the stage in that EAS environment
  with `eas env:set`, as plaintext. Those values are its scheme, its edges'
  public URLs under `EXPO_PUBLIC_`, and any stage secret already named
  `EXPO_PUBLIC_…`. `--dry-run` writes nothing.
- `MobileApp` takes `stages`, which says how a stage ships it where that
  differs from the defaults. The protected stage reads EAS's `production`
  environment and submits to Play's `production` track. Every other deployed
  stage reads `preview` and submits to `internal`. Every Android release is a
  `draft` unless the stage says `completed`.
- `gkm exec --stage <stage>` from a mobile app's directory runs with those
  same values, and needs no SSH. A command whose app reaches nothing on the
  stage's server network (a site or a mobile app) no longer opens an SSH
  connection.
- Fixed: a deployed stage no longer hands a site's build an email's
  `…_INBOX_URL`. That's Mailpit's local inbox, which a deployed stage
  doesn't have. A backend never got it, but a site did.
