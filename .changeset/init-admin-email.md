---
'@geekmidas/cli': patch
---

`gkm init --template fullstack` asks for the first admin's email (`--admin-email`; `--yes` takes `git config user.email`). It is written to a new seed, `db/database/seeds/03_admins.ts`, which gives each address in `ADMINS` a `users` row and the Member and Super admin roles before that person has signed in. Their first sign-in claims the row by email, so `users.auth_user_id` is now nullable until then. This replaces `scripts/grant-admin.ts`: to add an admin later, add their address to the list and run the seeds again.
