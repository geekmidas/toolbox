# `geekmidas/toolbox/actions/stages`

A composite GitHub Action that reads a gkm workspace's stages from its
`gkm.config.ts` and says which of them this workflow run builds and deploys,
as JSON a job's `strategy.matrix` reads with `fromJSON()`.

It runs the project's own `gkm stages --github-output`, so the stages come
through gkm's config loader (never a script parsing TypeScript), and the rules
below are tested code in the CLI the project installed. The action itself is a
few lines of shell that find the package manager and call it.

## Requirements

The job has checked out the project and installed its dependencies, with
`@geekmidas/cli` among them, before this step.

## Usage

```yaml
jobs:
  stages:
    runs-on: ubuntu-latest
    outputs:
      build: ${{ steps.stages.outputs.build }}
      deploy: ${{ steps.stages.outputs.deploy }}
      has-build: ${{ steps.stages.outputs.has-build }}
      has-deploy: ${{ steps.stages.outputs.has-deploy }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - id: stages
        uses: geekmidas/toolbox/actions/stages@<commit-sha> # @geekmidas/cli <version>
        with:
          stage: ${{ inputs.stage }}

  deploy:
    needs: stages
    if: needs.stages.outputs.has-deploy == 'true'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        stage: ${{ fromJSON(needs.stages.outputs.deploy) }}
    environment: ${{ matrix.stage }}
    steps:
      - run: echo "deploying $STAGE"
        env:
          STAGE: ${{ matrix.stage }}
```

`gkm init` writes a complete deploy workflow built on it for each deploy
target. See
[Deploying from GitHub Actions](https://geekmidas.github.io/toolbox/guide/deployment#deploying-from-github-actions).

## Inputs

| Input | Default | |
|---|---|---|
| `event` | `${{ github.event_name }}` | the event to plan for |
| `stage` | `''` | the stage a `workflow_dispatch` deploys; ignored for every other event |
| `working-directory` | `.` | the directory holding `gkm.config.ts` |
| `package-manager` | detected | `pnpm`, `npm`, `yarn` or `bun`; otherwise read from the nearest lockfile at or above `working-directory` |

## Outputs

Every output is a string `fromJSON()` reads.

| Output | Example | |
|---|---|---|
| `local` | `"dev"` | the local stage |
| `deployed` | `["staging","prod"]` | the deployed stages |
| `protected` | `["prod"]` | the protected stages (`[]` when none is) |
| `build` | `["staging","prod"]` | the stages whose images this run builds and pushes |
| `deploy` | `["staging"]` | the stages this run deploys |
| `has-build` | `true` | whether `build` is not empty |
| `has-deploy` | `true` | whether `deploy` is not empty |
| `aws-region` | `eu-west-1` | the region of an `ssm` or `secrets-manager` `secrets.store`, else `''` |

GitHub fails a matrix over `[]`, so gate each matrix job on `has-build` or
`has-deploy`.

## Rules

| Event | `build` | `deploy` |
|---|---|---|
| `push` | every deployed stage | the deployed stages, less the protected ones |
| `release` | `[]` | the protected stages |
| `workflow_dispatch` | `[]` | `[stage]`, where `stage` must be a deployed stage |
| anything else | `[]` | `[]` |

A `workflow_dispatch` naming no stage, or one that is not deployed, fails the
step with an `::error::` annotation that lists the deployed stages.

## Pinning

Pin the action to a **full commit SHA** and note the release beside it:

```yaml
uses: geekmidas/toolbox/actions/stages@<40-character sha> # @geekmidas/cli 10.1.0
```

A SHA cannot be moved, and the action runs code from this repository in your
workflow. `gkm init` does this for you: a published `@geekmidas/cli` knows the
commit it was released from (the release build records it), and the deploy
workflow it scaffolds is pinned to that commit, so the action and the CLI it
calls were released together. A CLI built from a checkout knows no release
commit and writes `@main` with a comment saying to pin it.

To update, replace the SHA with a later release commit, from the commit history
of `main` (each release is a `chore: version packages` commit). The action's
interface (its inputs and outputs) only grows, so a newer action works with an
older CLI that has `gkm stages --github-output`.

This repository does not push git tags for its releases, so there is no tag to
pin to yet.
