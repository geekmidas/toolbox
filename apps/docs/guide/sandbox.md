# The Sandbox

A deploy holds credentials: a Dokploy token, a registry login, AWS keys. It also
runs code from the repository it deploys. Loading `gkm.config.ts`, discovering
constructs, sniffing an app's environment, building it and running its
migrations all execute the project's own code.

On a developer's laptop, that is the developer's code. On a CI job for a pull
request from a fork, or on a shared build runner, it is not. That code should
not be able to read the credentials used to deploy it, hang the deploy, or
reach outside the checkout.

So every step that runs project code goes through a `Sandbox`. The steps that
need credentials (provisioning, pushing, releasing) are the deploy's own code
and never run in one.

## What runs in it

| Step | Timeout |
|---|---|
| Loading `gkm.config.ts` | 60 s |
| Discovering the workspace's constructs | 60 s |
| Sniffing each app's environment (its entry, routes and `envParser`) | 30 s per sniff |
| `gkm build`'s turbo run | none of its own (`TURBO_TOKEN` is passed on for a remote cache) |
| Dokploy target: the stage's migrations | 15 min |
| Compose target: bundling each backend | 10 min |
| SST target: `gkm build --provider aws` | 30 min |
| SST target: `sst deploy` | 90 min |
| `installDependencies()` | 15 min per command |

Each step is a child process started with an argument array, never a shell
line. A step that outlives its timeout is killed (SIGTERM, then SIGKILL) and
reported. A hung sniff, for example an entry that starts a server, no longer
holds the deploy and its lock forever.

The config is loaded in a child process with the CLI's own `tsx`, and comes back
as JSON checked by a schema. A program calling `deploy()` does not need `tsx`
loaded itself.

`docker build` is not a sandboxed step. It runs through the Docker daemon, and
the Dockerfile's steps run in Docker's own build containers.

## `LocalSandbox`, the default

Unless you pass one, a deploy runs these steps in a `LocalSandbox`: a child
process on the same machine, as the same user, with an **allowlisted
environment**. An allowlist rather than a denylist, because a credential's
variable can have any name its owner chose.

Passed on (`SANDBOX_ENV_ALLOWLIST`):

- finding programs and a home: `PATH`, `HOME`, `USER`, `LOGNAME`, `TMPDIR`,
  `TMP`, `TEMP`
- locale and terminal: `LANG`, `LANGUAGE`, `TZ`, `LC_*`, `TERM`, `COLORTERM`,
  `NO_COLOR`, `FORCE_COLOR`, `CI`
- Node: `NODE_ENV`, `NODE_EXTRA_CA_CERTS`
- package managers' homes: `COREPACK_HOME`, `PNPM_HOME`, `XDG_CACHE_HOME`,
  `XDG_DATA_HOME`
- proxies: `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` and their lowercase forms
- on Windows: `SystemRoot`, `windir`, `ComSpec`, `PATHEXT`, `USERPROFILE`,
  `APPDATA`, `LOCALAPPDATA`

Not passed on, deliberately:

- `AWS_*`, `DOCKER_*`, `DOKPLOY_*`, `GITHUB_TOKEN`, `TURBO_TOKEN`, `GKM_*`:
  credentials, or where the deploy keeps them
- `NODE_AUTH_TOKEN`, `NPM_TOKEN`, `npm_config_*`: registry tokens. This is why
  there is no `NODE_*` wildcard.
- `NODE_OPTIONS`: it can `--require` or `--import` code into every Node process
- `SHELL`, `EDITOR` and the rest of a login session

A proxy URL with a password in it does reach the command. If you keep one there
and deploy code you do not trust, use an isolating sandbox.

```ts
import { deploy, LocalSandbox } from '@geekmidas/cli/deploy';

deploy({
  cwd: checkout,
  stage: 'production',
  sandbox: new LocalSandbox({
    root: checkout,
    home: '/tmp/deploy-home',      // a scratch HOME: keeps ~/.aws, ~/.npmrc out of SDK lookups
    passEnv: ['SENTRY_AUTH_TOKEN'], // host variables to pass on by name
  }),
});
```

A `LocalSandbox` is **not isolating**. It hides the host's environment, but the
command can still read and write the host's filesystem as the user running the
deploy. It is the right default for code you already trust: your own project,
your team's CI. Code nobody vetted belongs in an isolating sandbox.

## Isolating sandboxes

A host that deploys repositories it does not trust passes its own sandbox, for
example a container per build, with `isolating: true`:

```ts
import { confineCwd, deploy, type Sandbox } from '@geekmidas/cli/deploy';

const sandbox: Sandbox = {
  root: checkout,
  isolating: true,
  env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp/home' },
  async exec(command, args, { cwd, env, timeoutMs, secrets, output, signal }) {
    const dir = confineCwd(checkout, cwd); // throws SandboxCwdEscape outside the checkout
    return runInContainer({ mount: checkout, command, args, cwd: dir, env, timeoutMs, secrets, output, signal });
  },
};

deploy({ cwd: checkout, stage: 'production', credentials, sandbox });
```

The contract for `exec(command, args, options)`:

- **`args`** is an argument array. Do not join it into a shell line.
- **`env`** is the command's whole environment. Add nothing of the host's.
  Callers start from `sandbox.env` and add what the step needs.
- **`timeoutMs`** is required. Kill the command when it passes and reject with
  `CommandTimedOut`.
- **`cwd`** must be the project root or below it. Refuse anything else with
  `SandboxCwdEscape`; `confineCwd(root, cwd)` does the check, symlinks
  included.
- **`secrets`** are mounted as files (see below).
- **`output`**: `capture` (the default) returns stdout and stderr in the result;
  `inherit`, `stderr` and `ignore` route them instead.
- **`signal`** kills the command when aborted.
- Resolve with `{ exitCode, signal, stdout, stderr }` however the command
  exited. A non-zero exit is a result, not an error.

The CLI runs its worker scripts with `node`, by their paths where the CLI is
installed (normally the checkout's `node_modules`). Mount the checkout, and the
CLI if it lives elsewhere, at the same paths inside the container.

### What changes under an isolating sandbox

Under an isolating sandbox the config reaches the deploy only as data. A live
object in `gkm.config.ts` cannot cross: a custom state store, an inline
`defineTarget({ … })`, a function. Such a config fails with
`ConfigObjectNotSerializable`, naming where the object is. Use a target package
and a built-in state provider instead.

Under the default `LocalSandbox`, a config with live objects is still imported
into the host process as well, as before. A project trusted to run on the host
is trusted to do that.

`loadWorkspaceConfig(cwd, { sandbox })` from `@geekmidas/cli/config` loads a
config the same way for other callers.

## Secrets as files

A step that needs a secret (the migrations need the database owner's URL) gets
it as a file, never as an environment variable. Variables are inherited by every
child, printed by crash reports, and visible in `/proc/<pid>/environ`.

`exec`'s `secrets` option is a map of file name to contents. The sandbox writes
each to a directory of its own, sets `GKM_SECRETS_DIR` in the command's
environment to that directory, and removes it when the command exits. A secret's
name must be a single path segment of letters, digits, `.`, `-` or `_`, not
starting with `.`; anything else fails with `SecretNameInvalid` before anything
is written.

An isolating sandbox must honour the same contract: mount the files and set
`GKM_SECRETS_DIR`.

## Installing dependencies without lifecycle scripts

A dependency's `postinstall` runs arbitrary code. To install an untrusted
checkout's dependencies without them:

```ts
import { installDependencies } from '@geekmidas/cli/deploy';

await installDependencies(sandbox, {
  ignoreScripts: true,
  allowScripts: ['esbuild'], // rebuilt by name once the install is done
});
```

This works with pnpm, npm and Yarn 2+. Yarn 1 and bun cannot rebuild named
packages, so they fail with `InstallScriptsAllowlistUnsupported`. An invalid
package name in `allowScripts` fails with `InstallAllowlistNameInvalid`.

## Related errors

| Error | Means |
|---|---|
| `SandboxCwdEscape` | A step was asked to run outside the project. Check the app paths in `gkm.config.ts` for `..` or an absolute path. |
| `CommandTimedOut` | A step outlived its timeout and was killed. |
| `CommandFailed` | A step exited non-zero where it had to succeed. |
| `SandboxWorkerFailed` | One of the CLI's worker scripts did not answer. |
| `ConfigLoadFailed`, `ConfigObjectNotSerializable` | `gkm.config.ts` could not be loaded, or holds a live object under an isolating sandbox. |
| `ConstructDiscoveryFailed`, `ConstructsNotSerializable` | Constructs could not be discovered, or not returned as data. |
| `SecretNameInvalid` | A secret's name is not a single safe path segment. |
