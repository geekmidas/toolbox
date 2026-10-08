---
'@geekmidas/events': minor
'@geekmidas/constructs': minor
'@geekmidas/cache': minor
'@geekmidas/storage': minor
'@geekmidas/emailkit': minor
'@geekmidas/cli': patch
---

:sparkles: One trace from a request through a queue to the worker: every events driver
(pg-boss, SNS, SQS, RabbitMQ, basic) wraps each publish in a PRODUCER span and
carries its W3C trace context in the message — SQS/SNS message attributes,
RabbitMQ headers, or pg-boss job data under the reserved key `__gkmTrace`,
which is removed before a handler sees the payload. Consumers run each job in a
CONSUMER span that continues it (a message without context starts a new
trace), Lambda queue and subscriber adaptors do the same from their records,
and each cron run is a root trace of its own. The constructs record their own
spans: a span per database query (`select orders`, with `db.system`, `db.name`,
`db.operation`, never parameter values), `cache.get`/`set`/`delete` with
hit/miss on the Redis and Postgres drivers, `storage.presign`/`put`/`delete`,
`email.send`, and a span per `ExternalApi` client call. Everything goes through
the global `@opentelemetry/api` and is a no-op without a registered provider.
