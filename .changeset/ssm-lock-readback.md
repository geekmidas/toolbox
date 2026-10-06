---
'@geekmidas/cli': patch
---

The SSM deploy lock is verified after it is taken

After creating the lock parameter, the SSM state store reads it back and holds the lock only if it is at version 1 with its own holder recorded. SSM's create-only put is atomic, so on AWS this changes nothing. On a backend where two racing creates can both succeed (the local AWS emulator does), the later one no longer gives a stage two concurrent deploys: both runners see `StateLocked`.
