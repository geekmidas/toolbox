---
'@geekmidas/cli': minor
---

`gkm deploy` holds the stage's lock for the whole run and journals every resource it creates

- **One deploy per stage at a time.** Deploy reads and writes state through `createStateStore` and takes `lock(stage, { operation: 'deploy' })` before it generates or provisions anything, releasing it when the run ends, however it ends. A second run gets `StateLocked`, naming the holder; a killed run's lock is released with `gkm state:unlock --stage <stage>`.
- **A journal instead of one write at the end.** The project, the stage's environment, each application and each domain are recorded `pending` before the create call and `ready` with their id after, and the state is written after every app. A run that dies part way keeps the ids it got back; the next one looks up anything left `pending` before creating it, so nothing is created twice. `gkm state:show` lists what a deploy stopped while creating.
- **Every write is conditional** on the version the run last wrote, so a writer that skipped the lock raises `StateVersionConflict` instead of being overwritten.
- **`state:pull`, `state:push` and `state:diff` go through the stores.** They copy and compare resource records as well as the state, migrate v1 on the way, and a push takes the remote stage's lock, so it cannot replace state a running deploy is writing.
- **Removed:** `CachedStateProvider`, `LocalStateProvider`, `SSMStateProvider`, `createStateProvider` and the `StateStoreProvider` bridge — nothing reads state through them any more. SSM state is read from SSM directly; a custom `StateProvider` in `state.provider` still works behind `LegacyStateStore`.
