# Dev Server Resilience Design

Status: parked / not yet started
Owner: TBD
Scope: `packages/cli/src/dev/index.ts`, `packages/cli/src/generators/Generator.ts`

## Background

Running `gkm dev` against a real workspace (e.g. `rezgo`: api, auth, web, app/Expo)
exposes three classes of failure. None are caused by user code; they are
limitations of the current dev orchestrator and hot-reload implementation.

## Issue 1 — Hot reload misses new files and serves stale transitive modules

### Symptoms

- Adding a new route file does not trigger a rebuild.
- After adding a new export to a non-route file, route files that import it
  fail with:
  `SyntaxError: The requested module '~/.../foo.ts' does not provide an export named 'bar'`
- Some changes "just don't get picked up" until the dev server is restarted.

### Root causes

1. **`add`/`unlink` events are ignored.** The chokidar watcher in `dev/index.ts`
   only listens for `change`:
   ```ts
   watcher.on('change', async (path) => { ... });
   ```
   New or deleted files never trigger a rebuild.

2. **Cache-bust is shallow.** `Generator.ts:load()` appends `?t=<now>` only to
   the top-level globbed route file URL. Node's ESM cache is keyed by URL, so
   any *transitive* import (services, domain modules, env, etc.) is served from
   cache forever within the CLI process. When a transitive module is edited,
   the route file is re-evaluated against the stale cached version → the
   "does not provide an export named" error above.

3. **Watch patterns are too narrow.** Only `routes`, `functions`, `crons`,
   `subscribers` (plus envParser / logger / hooks files) are watched. Edits to
   `src/domain/**`, `src/services/**`, etc. don't fire any rebuild even though
   those files are pulled in transitively at openapi/build time.

### Proposed fix

- Subscribe to `add` and `unlink` on the watcher and re-resolve the glob set
  before rebuilding.
- Broaden the watch pattern to cover the app's `src/**/*.{ts,tsx}` (configurable),
  not just construct entry directories.
- Bust transitive caches. Two viable approaches:
  - **Worker thread per rebuild** (preferred): move `EndpointGenerator.load` /
    `FunctionGenerator.load` / etc. into a short-lived `worker_threads` worker
    that gets recreated on each rebuild. Each worker has a fresh module graph,
    so transitive imports are guaranteed fresh. Cost is one worker spawn per
    rebuild (~50-100ms), but avoids the unbounded-memory leak of accumulating
    `?t=N` URLs in the main process.
  - **Custom loader hook**: install a Node loader that rewrites every resolved
    URL to include the current rebuild generation. Cheaper per rebuild but
    fragile (loader compatibility with tsx, source maps, etc.).

Worker thread is the recommended path.

## Issue 2 — Ctrl+C orphans `tsx`/`node` processes

### Symptoms

After pressing Ctrl+C in a workspace `gkm dev`, the shell returns but
`tsx` and `node` processes remain alive. Workaround is `killall node`.

### Process chain in workspace mode

```
shell
  └── gkm dev (top-level, workspace)
        └── pnpm turbo run dev          [spawned with detached: true]
              ├── @rezgo/api: gkm dev   (per-app)
              │     └── tsx              [spawned with detached: true]
              │           └── node       (Hono server)
              ├── @rezgo/auth: ...
              └── @rezgo/app: ...
```

### Root cause

The per-app `gkm dev` spawns `tsx` with `detached: true`
(`dev/index.ts:1521`). That moves tsx into a *new process group* outside the
turbo subtree. The workspace shutdown handler only sends SIGTERM/SIGKILL to
turbo's pgid; tsx's pgid is never targeted. After SIGKILL hits turbo's group,
the per-app gkm processes die *before* their async shutdown finishes calling
`process.kill(-tsxPgid, 'SIGKILL')`. tsx and its node child are orphaned.

The `detached: true` flag exists because the user's running Hono server may
ignore SIGTERM, so we need to kill its whole group. The design conflict is:
detaching tsx is necessary to forcibly kill it, but it also escapes the
top-level reachability tree.

### Proposed fix

Track every tsx PID centrally:

- Each `DevServer` registers its `tsx` pid into a shared `Set<number>` at the
  workspace level (or writes to a state file under `.gkm/`).
- Workspace shutdown iterates that set and issues `process.kill(-pid, 'SIGKILL')`
  for each known tsx pgid *before* falling back to the turbo-pgid SIGKILL.
- As belt-and-suspenders, drain the registry on per-app `gkm dev` exit so dead
  pids are not retargeted.

This makes the kill reachable regardless of process-group escape.

## Issue 3 — One app's crash brings down the whole workspace

### Symptoms

`@rezgo/app` (Expo) crashed with a Metro `DependencyGraph._onHasteChange`
TypeError. Within seconds, `@rezgo/api`, `@rezgo/auth`, `@rezgo/web` all
received SIGTERM and shut down. The user lost 21 minutes of warmed dev state.

### Root causes

1. **Turbo's persistent-task semantics.** When a persistent task in
   `turbo run dev` exits non-zero, turbo cancels sibling persistent tasks. There
   is no flag (as of turbo 2.x) that keeps survivors running through a sibling
   crash. `--continue` only affects scheduling of *queued* tasks, not running
   persistent ones.
2. **gkm's orchestrator treats turbo's non-zero exit as fatal.** In
   `workspaceDevCommand`:
   ```ts
   turboProcess.on('exit', (code) => {
     if (code !== null && code !== 0) {
       reject(new Error(`Turbo exited with code ${code}`));
     }
   });
   ```
   The reject fires the shutdown handler, which kills any survivors that
   turbo hadn't already torn down.

### Proposed fix

Stop using `turbo run dev` for the persistent dev loop. Build an in-process
supervisor inside `workspaceDevCommand`:

- Resolve dependency order via the existing `getAppBuildOrder` (we still use
  turbo's task graph indirectly via workspace config).
- For each app, `spawn` its dev command directly (`pnpm dev` in that app's
  cwd, or for backend apps invoke the per-app gkm dev codepath directly without
  going through pnpm/turbo).
- Supervise each child:
  - `on('exit', code)`: log the crash, do **not** propagate, schedule a restart
    with exponential backoff (start at 1s, cap at 30s, reset after a 60s clean
    run).
  - Stream stdout/stderr to the parent with an app-name prefix so output stays
    readable.
- Centralize the PID registry from Issue 2 here.
- Ctrl+C handler: iterate registry, SIGKILL each child group, then exit.

Turbo remains the build-time orchestrator (`gkm build`, dependency-ordered
package builds). Only the dev persistent loop is moved off it.

### Why not fix turbo's behavior instead

Tried first. `--continue=dependencies-successful` and friends don't apply to
sibling persistent tasks. Filing it upstream is fine, but the dev experience
needs to be fixed now and the supervisor pattern is also what makes Issues 1
and 2 solvable cleanly.

## Implementation order (when unparked)

1. Land the in-process supervisor (Issue 3 fix). This gives us a single owner
   of the dev process tree.
2. Move tsx PID registration into the supervisor (Issue 2 fix).
3. Move hot-reload (worker thread + broadened watcher + `add`/`unlink`) into
   the per-app branch of the supervisor (Issue 1 fix).

Each step is shippable independently. Order matters: 1 unblocks the cleanest
form of 2 and 3.

## Out of scope

- Replacing `tsx` (e.g. with `node --experimental-strip-types`).
- Native Bun runtime for dev — separate decision.
- Replacing chokidar.

## Open questions

- Should the supervisor expose a `--no-restart` flag for CI-like local runs?
- Restart backoff thresholds — should they be configurable per app in
  workspace config, or fixed?
- Should we surface a small status line ("3 of 4 apps running") when one app
  is dead but the rest are healthy?
