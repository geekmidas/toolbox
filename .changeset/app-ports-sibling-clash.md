---
'@geekmidas/cli': patch
---

`gkm dev` no longer starts two apps on one port after an app is added

Default ports are numbered across every app, backends before sites. Adding a
backend shifts the sites after it up by one, but `.gkm/app-ports.json` keeps
each app on the port it had. So the new app's default could be a port a
sibling had already saved. Both looked free, both were saved there, and every
`gkm dev` after that stopped with "Port conflicts detected".

A saved port now belongs to the app that saved it, and an app whose port a
sibling has saved moves to the next free port. It says so:
`↪️  reviewer: 3002 is web's — using 3005`. A file that already holds one
port twice is repaired on the next start: the first app in it keeps the port.
Two apps configured on the same port are still refused.
