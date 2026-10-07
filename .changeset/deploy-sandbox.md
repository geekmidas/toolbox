---
'@geekmidas/cli': minor
---

A deploy runs the project's own code in a sandbox, never with the deploy's credentials

- **`Sandbox`** (`@geekmidas/cli/deploy`): `exec(command, args, { cwd, env, timeoutMs, secrets?, output?, signal? })` — an argument array, the command's whole environment, a required timeout, secrets mounted as files (`GKM_SECRETS_DIR`), and a `cwd` confined to the project (`SandboxCwdEscape`). `isolating` says whether only data comes back.
- **`LocalSandbox`** is the default: a child process with `shell: false` and an allowlisted environment (`PATH`, `HOME`, `USER`, temp directories, locale, terminal, `NODE_ENV`, `NODE_EXTRA_CA_CERTS`, package-manager homes, proxies). No `AWS_*`, `DOKPLOY_*`, `DOCKER_*`, `NODE_AUTH_TOKEN`, `GITHUB_TOKEN` or `NODE_OPTIONS`. `home` points it at a scratch home; `passEnv` passes named variables on.
- **`deploy({ sandbox })`** runs the config load, construct discovery (the engine's too) and every sniff in it. A host deploying untrusted repositories passes its own, isolating one. Credentials only reach the provision, push and release steps, through the `CredentialProvider`.
- **The config loads in a child**, with the CLI's own tsx, and comes back as Zod-checked JSON — so a program calling `deploy()` no longer needs `tsx` loaded. Under an isolating sandbox a live object in the config (a custom state store, an inline target) fails with `ConfigObjectNotSerializable`; under the local sandbox such a config is still imported in-process, as before. `loadWorkspaceConfig(cwd, { sandbox })` does the same for other callers.
- **The env sniffer** runs every app's entry, routes and envParser in the sandbox with a 30s timeout (`SNIFF_TIMEOUT_MS`); a hung sniff is killed and reported. The envParser sniff used to import the module into the deploy itself.
- **`gkm build`** runs turbo in a `LocalSandbox` (passing `TURBO_TOKEN` on for a remote cache), or in `BuildOptions.sandbox`.
- **`installDependencies(sandbox, { ignoreScripts: true, allowScripts: ['esbuild'] })`** installs without lifecycle scripts and rebuilds only the allowed packages (pnpm, npm, Yarn 2+; `InstallScriptsAllowlistUnsupported` for Yarn 1 and bun).
- Named errors: `ConfigLoadFailed` (was a plain `Error`), `ConstructDiscoveryFailed`, `ConstructsNotSerializable`, `SandboxWorkerFailed`, `SecretNameInvalid`, `InstallAllowlistNameInvalid`.
