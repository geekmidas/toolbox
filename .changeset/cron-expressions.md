---
'@geekmidas/manifest': minor
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
'@geekmidas/cloud': minor
---

Crons take Unix or AWS cron expressions, and `rate(…)` is removed

**Breaking:** `rate(…)` schedules are no longer accepted. Write the cron they stand for, e.g. `rate(5 minutes)` is `cron(*/5 * * * *)` and `rate(1 day)` is `cron(0 0 * * *)`. `RateExpression` and `@geekmidas/cloud`'s `CronRate` are removed.

`.schedule()` takes a five-field Unix `cron(…)` or a six-field AWS one, and checks each by its own rules at compile time:

```ts
c.schedule('cron(0 9 * * MON-FRI)'); // Unix
c.schedule('cron(0 9 ? * 6#3 *)'); // AWS
c.schedule('cron(0 25 * * *)'); // type error: hour 25
```

`gkm build` and `gkm dev` validate every cron's schedule and fail on an invalid one, listing each cron with the field and token that failed. The manifest always records the AWS form, converting a Unix expression and warning when the conversion is approximate.

`@geekmidas/manifest` exports `parseCron`, `toAwsCron` and `toUnixCron`, and `cronPeriod`: the longest gap between runs in seconds, the period a heartbeat should expect.
