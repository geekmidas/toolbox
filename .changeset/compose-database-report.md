---
'@geekmidas/cli': patch
---

`gkm compose` no longer announces "Creating databases, roles and grants…" on a
stack that already has them. It applies the statements first and reports what
it actually did: `Created database …, role …` when something was missing, and
`Databases and roles already in place` when nothing was.
