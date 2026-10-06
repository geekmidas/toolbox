---
'@geekmidas/logger': patch
---

`createLogger({ pretty: true })` no longer pretty-prints in production

The check read `process.NODE_ENV`, which is always undefined, so `pretty: true` started the `pino-pretty` transport in production too. It reads `process.env.NODE_ENV` now.
