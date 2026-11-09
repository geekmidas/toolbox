---
'@geekmidas/edge': patch
'@geekmidas/cli': patch
---

New package: `@geekmidas/edge`, the edge in front of a stack

The route model, both reverse proxies' renderers, gkm's local certificate authority and the DNS providers move out of the CLI into one package. Anything that changes the edge while a stack runs can now use the same code where the CLI isn't installed. Nothing the CLI does changes.

- Each piece is its own entry point: `/routes`, `/proxy/caddy`, `/proxy/traefik`, `/certificates/local`, `/dns`, `/dns/route53`, `/dns/hostinger`, `/dns/godaddy`. Only `/dns/route53` loads the AWS SDK, which is now an optional peer.
- The providers take their credentials as given. `HostingerProvider` and `GoDaddyProvider` take a function, called the first time the API is used. Reading `GODADDY_API_TOKEN`, `HOSTINGER_API_TOKEN` or a stored `gkm login`, and saying what to do when there is none, stays in the CLI.
- `localAuthorityPaths(home)` takes the home it uses; the CLI passes `GKM_HOME` or `~/.gkm`.
- The edge's own errors extend `EdgeError`, which the CLI prints like its own: name and message, no stack.

The deployment guide gains "Scope each provider's credentials": what each DNS provider can be limited to, and a Route 53 IAM policy for one zone, the stack's record types and its names.
