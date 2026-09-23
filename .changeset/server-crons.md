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

**The schedule lives in Postgres.** pg-boss holds it, so a deployment running
four replicas fires each job once — which is what a timer in every process gets
wrong, and never reports. Without a `DATABASE_URL` it schedules nothing and says
why, rather than firing per replica and letting you find out from the data.

`toCronExpression` converts a `ScheduleExpression` to standard cron.
`cron(…)` unwraps; `rate(n unit)` converts when it divides its unit evenly.
When it does not — `rate(7 hours)`, whose `*/7` fires at 0, 7, 14, 21 and then
restarts three hours later — it throws rather than rounding. A job at the wrong
hour is harder to notice than one that refused to build.
