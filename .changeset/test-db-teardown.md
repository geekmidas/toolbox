---
'@geekmidas/cli': patch
---

`gkm test` drops the test stage's databases when the suite ends

The Vitest global setup (`@geekmidas/cli/vitest`) now returns a teardown that
runs `gkm test --teardown` once, when the suite ends (in watch mode, when the
watcher exits). The teardown drops the test databases the setup created and
forgets the test stage's reconcile state. The next run then creates, migrates
and seeds them from nothing, so an edited migration is applied again instead of
being skipped because it already ran.

- **What gets dropped:** setup records the databases it provisioned, and the
  Postgres port, in `.gkm/test-ready.json`. Only those are dropped, and any name
  without the `_test` suffix is refused (`NotATestDatabase`), because the
  container is shared with the local stage.
- **Open connections:** the drop uses `WITH (FORCE)`, so a connection the suite
  left open doesn't keep the database alive.
- **A killed run:** a run killed before its teardown leaves its record behind,
  and the next `gkm test` drops those databases before reconciling.
- **Buckets** in the test stage are not touched.
