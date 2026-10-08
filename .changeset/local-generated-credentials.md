---
'@geekmidas/cli': minor
---

Local services run with logins generated per machine, not a fixed shared one

:boom: Every container `gkm dev`, `gkm test` and the local `gkm compose` stage
run used to sign in with the same fixed word on every laptop. Each password,
token and secret key — Postgres, MinIO, Redis (which now requires one), the
cache proxy's token, RabbitMQ, the AWS emulator's secret key and the local
OpenObserve root — is now generated the first time it is needed, in the shape
the service accepts, and kept encrypted with the local stage's key in the CLI's
home, shared by every checkout of the project. User names are neutral:
`<workspace>_admin` for the Postgres superuser, `minio`, `rabbitmq`. A seed
kept with them salts each database role's password. The Postgres superuser on
a deployed `gkm compose` stack is renamed the same way.

`gkm dev` prints each service's address and login with its other URLs, and
`gkm dev:credentials [--json]` prints them without starting anything. The
discovery endpoint never carries them.

Existing volumes are migrated on the first run, data kept: a Postgres made with
the old login gets the generated superuser and the old one stops logging in
(reset from inside the container where no known login opens it); MinIO is
recreated with its new root login; RabbitMQ's user is updated with
`rabbitmqctl`. A service that cannot be moved keeps its login and gkm says how
to reset it.
