---
'@geekmidas/cli': patch
---

:bug: `gkm test` reliability: subscribers load in the harness, a dropped test database is recreated, and no two services share a port

- The generated harness imports every topic subscriber module itself. Delivery loads subscribers, and left to Node's own `import()` one importing a tsconfig alias (`~/…`) failed every test file that delivered.
- Reconcile's fast path checks the plan's Postgres databases still exist. Every checkout shares one Postgres, so another checkout's test teardown could drop `<name>_test` while this one's recorded state still claimed it — and the suite started with no database.
- Saved and observed ports are merged without collisions (`keptPorts`). An observed port overrode its own key but left a different saved key on the same number, so two services shared a port — Mailpit's inbox answered by an external API's fake.
