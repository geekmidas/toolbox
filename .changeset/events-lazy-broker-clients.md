---
'@geekmidas/events': patch
---

An app bundled into one file starts without `amqplib` or `pg-boss` installed

`RabbitMQConnection` and `PgBossConnection` imported their client library at the top of the module. `Publisher` and `Subscriber` only load those modules when a `rabbitmq://` or `pgboss://` string is used, but a bundler that inlines them (esbuild or rolldown with no code splitting, as a Lambda is built) moves that import to the top of the bundle, so a Lambda that only publishes to SQS crashed on load with `Cannot find package 'amqplib'`. Each connection now imports its library in `connect()`, the only place it is used.
