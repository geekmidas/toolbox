---
'@geekmidas/logger': patch
---

`createLogger` serializes an `Error` under `error` as well as `err`, with its type, message and stack. `logger.error({ error }, …)` used to write `"error":{}`. URL credentials in the serialized message and stack are masked, and path redaction (`error.message`, `err.stack`) applies to the serialized fields.
