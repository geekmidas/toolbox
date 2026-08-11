---
'@geekmidas/audit': patch
'@geekmidas/auth': patch
'@geekmidas/cache': patch
'@geekmidas/cli': patch
'@geekmidas/client': patch
'@geekmidas/cloud': patch
'@geekmidas/constructs': patch
'@geekmidas/db': patch
'@geekmidas/emailkit': patch
'@geekmidas/envkit': patch
'@geekmidas/errors': patch
'@geekmidas/events': patch
'@geekmidas/logger': patch
'@geekmidas/manifest': patch
'@geekmidas/rate-limit': patch
'@geekmidas/schema': patch
'@geekmidas/services': patch
'@geekmidas/storage': patch
'@geekmidas/studio': patch
'@geekmidas/telescope': patch
'@geekmidas/testkit': patch
'@geekmidas/ui': patch
---

Patch release across all packages to realign published versions with the
registry. The previous release only published the four packages that had
version bumps; the remaining packages failed with "cannot publish over the
previously published versions" because their versions were unchanged.
