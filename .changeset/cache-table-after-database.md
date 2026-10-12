---
'@geekmidas/cli': patch
---

`gkm test` and `gkm dev` provision a cache's table after the database it lives in

A cache kept as a table (`cache: 'db'`, the server targets' default) was provisioned
in declaration order, and `Cache` sorts before `Database`. On a fresh cluster, the
check for its table ran against a database not yet created, so the first
`gkm test` of a new fullstack project stopped with
`database "database_test" does not exist`. Every cache table is now created once
every database and its roles exist.
