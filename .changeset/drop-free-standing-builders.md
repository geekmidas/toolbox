---
'@geekmidas/constructs': major
'@geekmidas/cli': major
---

`c`, `s` and `f` are gone

The free-standing builders produced a construct with no owner, and an unowned
construct no longer builds: it has nothing to take a logger or an environment
parser from, and nothing says which process runs it. Keeping them exported
meant shipping an API whose only outcome was a build error.

Everything runnable now comes from the process that runs it:

```ts
export const worker = new Worker('Jobs', { logger }).database(database);

export const cleanup = worker.cron('rate(1 day)').handle(async ({ logger }) => { … });
export const onUserCreated = worker.subscribers.topic(users).subscribe(['user.created']).handle(…);
export const reindex = worker.functions.input(…).handle(…);
```

A worker is not a container — it names which process runs a runnable and what
logger it runs with — so declaring one costs nothing, and declaring several is
several groupings rather than several deployments.

Migration is mechanical: declare a `Worker`, then replace `c` with
`worker.crons`, `s` with `worker.subscribers` and `f` with `worker.functions`.
The `.logger(…)` call each of them used to need goes away, because the worker
carries it.
