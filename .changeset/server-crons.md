---
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

Crons run on a server target

A cron used to run on AWS Lambda and nowhere else. `CronGenerator` returned an
empty array for every other provider, and `.gkm/server/` held `endpoints.ts`,
`queues.ts` and `subscribers.ts` but no crons — so a scheduled job on a server
deploy built, deployed, and never fired.

It now generates `crons.ts` exporting `setupCrons`, which the generated entry
calls beside `setupSubscribers` and `setupQueues`. Same shape, same place: the
process that serves the endpoints schedules the crons.

**The schedule lives in Postgres**, in the database the worker names:

```ts
export const jobs = new Worker('Jobs', { logger }).database(database);
```

pg-boss holds it there, so a deployment running four replicas fires each job
once — which is what a timer in every process gets wrong and never reports.

Declared rather than discovered, and no connection string appears anywhere. The
construct that owns the database is the only thing that knows its key; it is
resolved through service discovery like any other dependency. Inferring the
store from whatever database an app happened to declare would work until it
declared a second, and then move the schedules without saying so.

**A known limitation of workers.** A worker with crons and no `.database(…)`
schedules nothing on a server target and reports why at startup. On AWS the
question does not arise — a cron is an EventBridge rule. The store could as
well be a cache or something the deploy target provisions; Postgres is what
exists today.

`toCronExpression` converts a `ScheduleExpression` to standard cron.
`cron(…)` unwraps; `rate(n unit)` converts when it divides its unit evenly.
When it does not — `rate(7 hours)`, whose `*/7` fires at 0, 7, 14, 21 and then
restarts three hours later — it throws rather than rounding. A job at the wrong
hour is harder to notice than one that refused to build.
