---
'@geekmidas/cli': minor
---

A RestApi's production server serves HTTP only

`gkm build --production` (what `gkm docker`'s images run) wired every queue consumer, cron and topic subscriber into the server it built, because they sat in the API's directory. They belong to a `Worker`, so a production server that serves a RestApi now leaves them out, SNS push routes included, and the build says what it left out (`Serving Api only: leaving out 1 cron, 1 queue consumer, 1 subscriber`). Publishing (`.event(...)`, sending to a queue) is unchanged. `gkm dev` still runs everything in one process. Workers get their own deploy unit separately; until then, background work does not run in a server deploy.
