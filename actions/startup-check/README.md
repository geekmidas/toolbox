# `geekmidas/toolbox/actions/startup-check`

A composite GitHub Action that starts every image a gkm stage runs before
anything is pushed, and fails the job unless each one turns healthy.

A bundle that builds, typechecks and passes every test can still fail to
start. A package that finds its own files at runtime, for example
`createRequire(import.meta.url).resolve('pdfjs-dist/package.json')`, is inlined
into `server.mjs` and so is missing from the image's `node_modules`. Tests run
from source, where `node_modules` exists, so they pass. Without a check, the
server is the first place the failure shows up.

It runs the project's own `gkm compose --stage <stage> --build --check`, so the
rules are tested code in the CLI the project installed. The action itself is a
few lines of shell that find the package manager and call it.

## What the check does

- **Images:** builds the images a deploy builds (`gkm compose --build`). With
  `push: true`, it pushes them only after every one passes, so the digests it
  checked are the digests it pushes.
- **Config:** uses the stage's real secrets, read through the stage's store
  the way a build reads them. It never uses fakes or placeholders. The stage
  must be deployed and must not be protected (`stages.protected`). gkm refuses
  a protected stage, because this check runs on every pull request.
- **Services:** starts the backing services the constructs declare (Postgres,
  Redis, …) on the runner and applies the migrations. It runs no seeds.
- **Probe:** each app, worker and processor must pass its own container
  health check.
- **On failure:** names each container that did not start, prints its last
  50 log lines, exits non-zero and pushes nothing.

The check runs as its own compose project (`<project>-<stage>-check`). It is
removed with its volumes whether the check passes or fails.

A check on a runner cannot see the server's network, its real database, DNS or
the edge. It proves that each image starts. It does not prove the server can
run it.

## Requirements

Before this step, the job must have:

- checked out the project and installed its dependencies, `@geekmidas/cli`
  among them
- Docker available (GitHub's `ubuntu-latest` runners have it)
- access to the stage's secrets store, for example by assuming the stage's AWS
  role for an `ssm`, `secrets-manager` or `s3` store

## Usage

On every pull request, against a stage that is not protected, in that stage's
GitHub environment:

```yaml
jobs:
  startup-check:
    runs-on: ubuntu-latest
    environment: staging
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: eu-west-1
      - uses: geekmidas/toolbox/actions/startup-check@<commit-sha> # @geekmidas/cli <version>
        with:
          stage: staging
```

In a deploy's build job, to check before pushing:

```yaml
      - uses: geekmidas/toolbox/actions/startup-check@<commit-sha>
        with:
          stage: staging
          push: true
          tag: ${{ github.sha }}
          digests-file: digests.json
```

The deploy workflow that `gkm init --deploy compose` scaffolds already runs
`--check` in its build job for every stage that is not protected.

## Inputs

| Input | Default | |
|---|---|---|
| `stage` | required | the deployed, unprotected stage whose secrets the images start with |
| `push` | `'false'` | `'true'` pushes the images once every one has passed |
| `tag` | the commit | the tag to build and push at |
| `digests-file` | `''` | with `push`, where each pushed image's `<ref>@sha256:…` is written |
| `working-directory` | `.` | the directory holding `gkm.config.ts` |
| `package-manager` | detected | `pnpm`, `npm`, `yarn` or `bun`; otherwise read from the nearest lockfile at or above `working-directory` |
