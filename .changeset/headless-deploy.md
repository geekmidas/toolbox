---
'@geekmidas/cli': minor
---

:boom: `deploy()` from `@geekmidas/cli/deploy`: a deploy that never prompts, prints or exits, and stage keys kept by project identity

- **`deploy(input)`** (new subpath `@geekmidas/cli/deploy`) takes an explicit `cwd`, a `CredentialProvider`, a `logger` and an `AbortSignal`, and returns a run: iterate it for plain-JSON events (`phase.started`/`finished`, `log`, `resource.applied`/`planned`, `artifact.built`, `app.deployed`, `app.failed`, `deploy.finished`, `deploy.failed`), and await `result` for a structured `DeployResult`. Nothing below the CLI prompts or calls `process.exit`; a credential no provider has raises `MissingCredential`, naming it and how to supply it.
- **`gkm deploy` is a thin wrapper** that owns the prompts, the stored login and the exit code. Its human output is unchanged. New flags: `--json` (events as JSON lines on stdout; never prompts) and `--dry-run` (read-only Dokploy calls, no lock, no state, no generated secrets, nothing built or pushed).
- **Builds run in each app's own directory**, not the process's working directory.
- :boom: **Stage keys move** from `~/.gkm/<folder>/<stage>.key` to `~/.gkm/keys/<namespace>/<project>/<stage>.key` — the `<namespace>/<project>` a deploy claims its Dokploy project by — so two projects in folders with the same name no longer share (and overwrite) keys. An existing key is copied to the new place the first time it is read, and the old file is kept. `GKM_HOME` moves the whole home (keys and `credentials.json`). A workspace that sets `deploy.namespace` takes its default-namespace key along; changing from one namespace to another needs the key copied by hand. Generated GitHub workflows write the key to the new place.
- Without a terminal, a missing Dokploy or registry login is `MissingCredential` rather than `Interactive input required`. The registry login can also come from `DOCKER_REGISTRY_USERNAME` / `DOCKER_REGISTRY_PASSWORD`, and the Dokploy endpoint from `deploy.dokploy.endpoint` when only the token is in the environment.
- `workspaceDeployCommand` and `deployCommand` are `@deprecated` wrappers for one alpha and return the new `DeployResult` (a superset of `WorkspaceDeployResult`). The old single-image `DeployResult` type is now `DockerDeployResult`.
