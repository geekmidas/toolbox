---
'@geekmidas/cli': patch
---

A stage's encryption key is written whole, or not at all

Two commands creating the same stage's key at once could fail with
`KeyNotFound`. The key file was created empty and filled in afterwards, so
the command that lost the race to create it could read it in between, find
nothing, and stop. A key is now written beside its final path and then linked
or renamed into place, so a reader sees either no key or the complete one.
Keys copied over from their old location are placed the same way.
