---
'@geekmidas/cli': patch
---

`gkm deploy:github` now gives a compose stage's CI role the permissions an `ses` inbox (`deploy.inbox.<stage>`) needs. Before this, a CI deploy of such a stage was refused by AWS, while the same deploy run with your own credentials worked. The role may now verify the domain and manage SES receipt rules. It may also create each inbox's bucket, SNS topic and IAM user, but only those, by name.
