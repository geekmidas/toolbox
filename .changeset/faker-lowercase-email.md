---
'@geekmidas/testkit': patch
---

testkit's `faker` makes every email address lowercase

`faker.internet.email()` and `faker.internet.exampleEmail()` now return
lowercase addresses. That covers the `faker` a feature test is handed and
the one factories build with. Better Auth stores addresses lowercased, so a
test that signed in as faker's `Ada.Lovelace@…` and read back
`ada.lovelace@…` failed only when faker happened to capitalise. The rest of
`faker.internet` is unchanged.
