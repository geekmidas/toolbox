---
'@geekmidas/cli': minor
---

A compose deploy deletes the DNS records of hosts the stage no longer serves

When a stage's domain changes, or an app is renamed or removed, the deploy now goes through the `dns-record` resources it wrote in the stage's state. Once the stack answers on its new hosts, it deletes each recorded record the plan no longer has. A record is deleted only if its provider still holds the value gkm wrote: one that has been pointed elsewhere since is left alone. One no provider can delete (a `manual` domain, a domain gone from `dns`, a write-only key) is printed for a person to remove. All of them are forgotten from the stage's state. A deploy that fails before verify deletes nothing, and `--dry-run` prints what would be deleted. `diffRecordedDns` (pure) and `pruneStackDns` in `compose/dns` are the diff and the delete.
