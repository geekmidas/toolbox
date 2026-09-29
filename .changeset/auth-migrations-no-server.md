---
'@geekmidas/constructs': patch
---

`BetterAuth.migrations()` no longer logs a schema mismatch before migrating

It built a full better-auth server just to read its options back, and
better-auth checks its schema when a server starts — so every migration against
a fresh database began with `ERROR [Better Auth]: Database schema mismatch —
Missing tables user, session, account, verification`, about the very tables it
was about to create. The options are now assembled once and handed to the server
and to the migration builder alike, so migrating starts no server.
