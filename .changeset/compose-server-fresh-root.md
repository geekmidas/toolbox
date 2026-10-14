---
'@geekmidas/cli': patch
---

`gkm compose:server` sets up a brand-new server whose root logs in with a password: it creates the admin as root, copies your key to the admin with `ssh-copy-id`, then turns password and root logins off and locks root's password. The stage's state records that the server is set up (`server:compose`, with who and when), and a later run says so. On a server already set up, someone whose key can't log in is stopped and told to ask whoever set it up, rather than offered root or `ssh-copy-id`. With no `--admin`, it logs in as the user `ssh` itself would (`~/.ssh/config`, else this computer's username); `--identity` names the key.
