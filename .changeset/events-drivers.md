---
'@geekmidas/events': minor
'@geekmidas/cli': minor
---

:boom: Event brokers are drivers, registered by the entry point, so a bundle carries only its own broker

- **`registerEventsDriver(driver)`.** `Publisher`, `Subscriber` and `EventConnectionFactory` pick a broker by the connection string's scheme from a registry instead of a literal `import()` per broker. esbuild followed every one of those, so `gkm build --provider server --production` failed with `Could not resolve "pg-boss"` / `"amqplib"` for a project that had not installed every broker (#192). Each broker's subpath exports its driver and is the only module that imports its peer dependency: `basicEventsDriver` (`/basic`), `pgbossEventsDriver` (`/pgboss`), `rabbitmqEventsDriver` (`/rabbitmq`), `snsEventsDriver` (`/sns`), `sqsEventsDriver` (`/sqs`). `eventsDriverFor(scheme)` and `registeredEventsSchemes()` look them up.
- **An unregistered broker throws `UnregisteredEventsScheme`**, carrying the `scheme`, the `subpath` and `driver` to register, and what is `registered`. A script that builds its own publisher adds `registerEventsDriver(pgbossEventsDriver)` (or its broker's) once before the first call. A scheme no broker implements still throws `UnsupportedEventTransport`.
- **Generated entries register their target's broker** — `EVENTS_DRIVERS` beside the cache and storage drivers: pg-boss on a server, SNS and SQS on AWS, the local stage's broker in `gkm dev` and `gkm test`. Only when the app declares a `Topic` or a `Queue` (or, on pg-boss, a worker whose crons it schedules), so a project without events resolves nothing. The production and dev servers, and every Lambda handler — endpoint, function, cron, queue consumer and subscriber — register them; the function, cron, queue and subscriber handlers now register the storage and cache drivers too.
- A server's SNS push subscriptions are generated only when its broker is SNS, and its crons reach pg-boss through the registered driver, so neither drags the other broker's client into the bundle. An app that declares no crons gets a crons file that imports nothing.
- `Publisher.fromConnection(connection, options)` takes the publisher options, as `fromConnectionString` does.
