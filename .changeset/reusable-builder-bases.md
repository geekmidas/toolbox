---
'@geekmidas/constructs': minor
---

A configured builder can be reused as a base

Builder methods now return a new builder instead of changing the one they were called on, and `.handle()` no longer resets the builder. A base like `const base = c.logger(logger).timeout(60_000)` keeps its configuration for every cron built from it; before, the first `.handle()` wiped it, so the second cron silently came back on the default logger and timeout. Two chains started from one base also no longer share state.

This applies to the function, cron, subscriber, queue, topic and endpoint builders. Chained code is unaffected. Code that calls a method without using its result, such as `builder.timeout(30); builder.handle(…)`, must chain instead: `builder.timeout(30).handle(…)`.
