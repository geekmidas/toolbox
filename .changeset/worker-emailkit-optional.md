---
'@geekmidas/constructs': patch
---

A `Worker` starts without `@geekmidas/emailkit` installed

Since inbox subscribers stopped reply loops, `@geekmidas/constructs/worker` imported `@geekmidas/emailkit` when it loaded, so a project without that optional peer crashed on start, and its image build failed. The inbox subscriber now loads emailkit's `Auto-Submitted` helpers when it receives mail, which only a project with an `Inbox` (and so with emailkit) does.
