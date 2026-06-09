---
"@geekmidas/constructs": patch
---

Add and export `AWSScheduledFunction` from `@geekmidas/constructs/crons` (and `/aws`). The CLI's cron handler generator already imported this adaptor, but it was never implemented, so generated cron handlers failed to load. `AWSScheduledFunction` wraps a `Cron` (which extends `Function`) and reuses the Lambda function execution pipeline, including the `runWithRequestContext` wrapper that powers request-scoped logging.
