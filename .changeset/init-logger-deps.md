---
'@geekmidas/cli': patch
---

`gkm init` installs `pino` only for the pino logger

The API, minimal, serverless and worker templates listed `pino` among their
dependencies whatever logger was chosen, so a console-logger project installed
a logging library it never imports. `pino` is now added only when the pino
logger is picked, beside the `@geekmidas/logger/pino` import it serves.
