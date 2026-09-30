---
'@geekmidas/cli': patch
---

`RABBITMQ_URL` and the rabbitmq credentials behind it are gone

A RabbitMQ container got a generated password, and from it `RABBITMQ_URL`
and `RABBITMQ_USER`/`_PASSWORD`/`_HOST`/`_PORT`/`_VHOST`. The container runs
as the local user, so none of them could connect. A topic's broker URL is its
own key — `USERS_PUBLISHER_CONNECTION_STRING` for a `users` topic — which
reconcile derives from the declaration, `rabbitmq://` or `pgboss://` by target.

The stored `eventsBackend` goes with it: nothing passed one any more, and it
was the other way an `amqp://` URL built from those credentials got in.
