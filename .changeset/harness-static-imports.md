---
'@geekmidas/cli': patch
'@geekmidas/constructs': patch
---

The generated test harness imports the app's modules itself

`featureTest` imported each construct and endpoint by path. From a published
`@geekmidas/constructs` — inside `node_modules` — Vitest leaves that dynamic
import to Node, which knows nothing of the app's tsconfig paths, so the first
endpoint importing `~/router.ts` failed with `Cannot find package '~'`. (In this
repo the packages are linked sources, which Vite processes, so it never showed.)

The generated `index.ts` now imports every module the manifest records,
statically, from inside the app, and hands them to `featureTest` as `modules`
keyed by the recorded path — resolving the way the app's own code does. A
module not handed over is still imported by path.
