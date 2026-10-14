---
'@geekmidas/cli': minor
---

`gkm compose:server` sets a stage's server up for compose deploys

From your machine, as the server's sudo user (asked for, never root), it
hardens the VPS — SSH by key only with root's login off, ufw open on SSH, 80
and 443 alone, daily security updates, fail2ban on sshd — installs Docker from
Docker's repository, and creates the deploy user with a key that may run
commands and open the migration tunnel, nothing more. It pins the server's host
key (checked against the server's own fingerprint) and gives the stage's GitHub
environment `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`, then logs in as CI will
to check Docker and the tunnel. A server only root can reach gets its admin
first. `--dry-run` prints the plan and the exact script, and connects to
nothing.
