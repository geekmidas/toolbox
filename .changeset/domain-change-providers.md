---
'@geekmidas/cli': patch
---

A compose deploy after a stage changes its domain now moves what providers made, not just the server's records:

- **Old provider DNS records are deleted.** Records written by providers (DKIM, MX, certificate validation, a file server's CNAME) are now kept in the stage's state. Once the apps answer, any record no provider asks for anymore is deleted, by the same rules as the stack's own records.
- **`MAIL_FROM` follows the new domain.** If gkm wrote the address, it becomes `noreply@<new domain>`. An address you set yourself is kept.
- **CloudFront certificates:** a file server whose host changes within an hour of the last certificate request now gets a certificate for the new host. Before, ACM handed back the old host's certificate.
