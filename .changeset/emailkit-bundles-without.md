---
'@geekmidas/constructs': patch
---

:bug: A server bundle builds without `@geekmidas/emailkit` installed

The worker loads emailkit lazily, but bundling a server (`gkm build`, esbuild) still failed with `Could not resolve "@geekmidas/emailkit/autoSubmitted"`. That broke every app that does not install emailkit. A missing emailkit is now left to run time. It is bundled in as before wherever it is installed. A worker that receives inbox mail without it throws `InboxNeedsEmailkit`, which says to install it.
