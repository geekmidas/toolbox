---
'@geekmidas/cli': patch
---

Seeds run with the drivers the stage's entry registers

`gkm seed`, `gkm dev --seed`, `gkm test`'s setup and `compose`/`dokploy`
deploys ran seeds without registering a single driver, so a seed that reached a
bucket through its construct failed with `UnregisteredStorageScheme`. The only
workaround was for the app to call `registerStorageDriver(s3Driver)` itself,
which names a provider in exactly the layer that is meant to stay neutral. The
seed runner now registers what a generated entry for the project would: storage,
the cache backend and the events broker, chosen by the same `driversFor`.
