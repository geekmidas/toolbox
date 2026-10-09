---
'@geekmidas/cli': minor
---

:boom: **A compose deploy drives the stage's server over SSH; gkm no longer runs on the server.**
`gkm compose --stage <stage>` (and `gkm deploy` through compose) runs where
it is started — a CI runner, a laptop — and sets
`DOCKER_HOST=ssh://user@host` for every docker and compose call it makes for
a deployed stage. The local stage keeps this machine's Docker.

- :boom: **A deployed compose stage needs a server.** Name its SSH login in
  `deploy.compose.server`:
  `deploy: { compose: { server: { production: { user: 'deploy' } } } }`. The
  host is the stage's `GKM_SERVER_IPV4` secret unless `host` is set, the port
  22 unless `port` is. A deployed stage without one fails with
  `ComposeServerMissing` before anything happens, so `gkm compose --stage
  prod` on a laptop never starts prod in the laptop's Docker. Before a deploy
  changes anything, a read-only `docker version` over SSH checks the login
  (`ComposeServerUnreachable`, quoting ssh's stderr); a dry run prints
  `→ deploy@<host> (docker over ssh)` and connects to nothing.
- :boom: **The deploy no longer runs on the server.** The server needs Docker
  with its compose plugin, a deploy user in the docker group with an
  authorised key, and ports 22/80/443 — no gkm, Node, checkout, `docker
  login`, AWS CLI or cloud credentials. The stage's secrets, its deploy state
  and the DNS token stay where the deploy runs. Env files are read where the
  deploy runs and sent with each container's create call, so no secret is
  written to the server's disk. Caddy's Caddyfile and a stage's own
  certificate are inline compose `configs` (compose v2.23+), and the shared
  Traefik edge keeps its static configuration inline and its routes and
  certificates in volumes written with `docker exec` — nothing is mounted
  from a path. An edge an older gkm started from `~/.gkm/edge` is recreated
  on the first deploy; each stack on it registers again on its next deploy.
- **Migrations and seeds** run where the deploy runs, through an SSH tunnel to
  the stack's Postgres on the server's loopback (and MinIO's, for buckets);
  neither is ever published beyond it (`ComposeTunnelFailed` when sshd
  refuses forwarding).
- :boom: **Removed flags:** `--resources-only` and `--skip-resources` on
  `gkm deploy` and `gkm compose`, with `ResourcesOnlyAndSkipped`, the
  `resources` hook of a deploy target, and the stages action's `resources`
  output. One deploy on the runner creates the resources, writes the DNS
  records and starts the stack.
- **CI.** The scaffolded compose workflow's deploy job is one step on the
  runner: checkout, install, a read-only registry login, the stage's role, the
  deploy key and pinned host key (`DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`),
  then `gkm compose --stage "$STAGE" --tag "$SHA" --digests-file digests.json`
  with `GODADDY_API_TOKEN`. The SSH step that ran gkm on the server, and the
  `DEPLOY_HOST`, `DEPLOY_USER` and `DEPLOY_PATH` variables, are gone. `gkm
  init --deploy compose` scaffolds `deploy.compose.server` for each deployed
  stage.
- The server's address (`GKM_SERVER_*`) is no longer masked in what a deploy
  prints: it is in public DNS, and it is where the deploy goes. The log UI's
  tunnel line names the stage's server login rather than a guess.
