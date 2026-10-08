---
'@geekmidas/cli': patch
---

Local ports: a saved port in `.gkm/ports.json` that another stack has bound since — another checkout of the same project hashes to the same block — is moved to a free one with a one-line notice, instead of failing `docker compose up` with "port is already allocated". A port this project's own container holds is kept. The free-port probe also checks `127.0.0.1`, which a wildcard bind on macOS does not see.
