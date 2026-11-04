---
'@geekmidas/cli': minor
---

`deploy.email.<stage>: { provider: 'ses' }` provisions a stage's outbound mail at deploy

Each deploy of the stage creates, in its AWS account, what every `Email`
construct sends with, and writes `<ID>_URL` and `<ID>_FROM` into the stage's
secrets before its checks:
- the sender's domain as an SES identity, verified by DKIM through `dns`;
- an IAM user allowed only `ses:SendRawEmail` as that identity;
- its access key, as `smtp://<key id>:<smtp password>@email-smtp.<region>.amazonaws.com:587`.

`from` names the sender (default `noreply@<stage domain>`). A `<ID>_URL` the
stage already holds wins and nothing is created for it. `--rotate-keys`
issues a successor key and password. A sandboxed SES account is reported at
deploy. `gkm deploy:github` scopes the stage's role to it.
