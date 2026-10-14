---
'@geekmidas/cli': patch
---

`gkm compose:server` sets up a brand-new server whose root logs in with a password: it creates the admin as root, copies your key to the admin with `ssh-copy-id`, then turns password and root logins off and locks root's password. What it set up — the admin, the deploy key's path and the pinned host key — is kept in the stage's state (`server:compose`), so the next run asks for none of it.
