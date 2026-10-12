---
'@geekmidas/cli': minor
---

`gkm deploy:google-play` sets up publishing a mobile app to Google Play

One run, as a Play Console admin, replaces the manual "Google Service Account
key" steps:

- each deployed stage's Play track and release status in `eas.json`;
- a Google Cloud project (`--project`, or `<workspace>-play`, created when
  absent) with the Android Publisher API enabled, and a `<workspace>-play`
  service account in it;
- the account invited in Play Console with a grant on the app alone. Its
  permissions follow the stages' tracks: production releases only when a
  stage submits to production, and listing edits only when the app keeps a
  listing;
- a new JSON key, held in memory only, uploaded to EAS and assigned for EAS
  Submit, then verified by opening and discarding an edit with it. Only then
  are older keys deleted from EAS and Google;
- the store listing and data safety form from `store/play/` (fastlane
  supply's layout), pushed through an edit;
- a checklist of the declarations Play Console only takes by hand.

Signing in uses gcloud's application-default login, in gkm's own gcloud
config. The app's package and EAS project come from its Expo config.
