---
'@geekmidas/cli': patch
---

`deploy.email` with `ses` checks the sending domain's DKIM status, not just its domain verification. A domain verified only by its older TXT record is now given DKIM, rather than sending unsigned. A verified domain whose DKIM signing was turned off has it turned back on. `gkm deploy:github` grants `ses:GetIdentityDkimAttributes` and `ses:SetIdentityDkimEnabled` in place of `ses:GetIdentityVerificationAttributes`.
