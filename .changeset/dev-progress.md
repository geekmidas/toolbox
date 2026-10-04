---
'@geekmidas/cli': patch
---

:loud_sound: `gkm dev` says what it is doing while it starts

A first `gkm dev` pulled every image, waited on each health check and created every database with nothing on screen — minutes that read as a hang. It now names each step as it begins: reading `gkm.config.ts` and the constructs, starting the containers (with Docker's own progress shown — the pulls, each container created and turning healthy), creating the databases, roles, buckets and topics, checking or applying migrations, building each app, and starting the apps. A converged start says none of the reconcile steps, and `gkm test` and other background reconciles stay silent.
