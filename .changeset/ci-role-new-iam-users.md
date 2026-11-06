---
'@geekmidas/cli': patch
---

A stage's first deploy from CI can create its IAM users

The role `gkm deploy:github` writes allows the deploy's IAM user actions on
`user/gkm/<name>` only. A deploy first looks the user up with `iam:GetUser`,
and IAM authorizes a call on a user that does not exist yet against
`user/<name>`: it has no path to know. So a stage whose first deploy ran from
CI was denied before the user was created, and only a stage first deployed
from an administrator's machine worked from CI afterwards.

Each user statement (bucket, mail, inbox and backups users) now names both
ARNs. Re-run `gkm deploy:github --stage <stage>` to update the role.
