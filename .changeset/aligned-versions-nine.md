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

Align every published package on a single version and keep them in step.

All packages now share one version, enforced by a changesets `fixed` group. The
baseline is 9.0.1 — @geekmidas/client's published version — so nothing moves
backwards; this release takes the whole set to 9.0.2 together.

Independent versions made "which version of the docs applies to me"
unanswerable: a reader on constructs@7 and cli@2 was on no version at all. One
number per release makes versioned documentation possible, and lets 9 freeze as
the current paradigm while the constructs rework is developed against it.

Every release now publishes every package, and a major anywhere is a major
everywhere. Peer ranges get simpler in return.
