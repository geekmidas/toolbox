---
'@geekmidas/cli': patch
---

`ComposeTunnelFailed` names the likely cause of a refused migration tunnel: a
deploy key installed with `restrict` in `authorized_keys` refuses port
forwarding unless it also says `port-forwarding`
(`restrict,port-forwarding ssh-ed25519 …`), and sshd must allow it
(`AllowTcpForwarding yes` or `local`).
