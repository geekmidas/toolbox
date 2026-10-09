/**
 * The GitHub workflows a scaffold ships with.
 *
 * - `ci.yml` — every pull request builds, lints, typechecks and tests.
 * - `release-drafter.yml` — merged pull requests accumulate in a draft
 *   release, labelled from their titles.
 * - `deploy.yml` — when a deploy target was picked: a push to main deploys the
 *   stages that are not protected, publishing the drafted release deploys the
 *   protected ones, and a manual run deploys the one stage it names.
 *
 * The deploy workflow names no stage. Its first job runs the
 * `geekmidas/toolbox/actions/stages` action, which asks the project's own
 * `gkm stages --github-output` which stages the run builds and deploys — so
 * the config stays the one place stages are declared, the rules for each event
 * are tested code in the CLI, and a workflow cannot fall out of step with
 * either.
 */

import { projectKey } from '../../secrets/keystore.js';
import { stagesActionUses } from '../stagesAction.js';
import type { GeneratedFile, TemplateOptions } from '../templates/index.js';

/** How each package manager is set up, installs, and runs a script. */
const TOOLING = {
	pnpm: {
		// The version comes from \`packageManager\` in package.json, which only
		// the workspace scaffold pins; the action refuses both at once.
		setup: `      - uses: pnpm/action-setup@v4
PNPM_VERSION
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
`,
		install: 'pnpm install --frozen-lockfile',
		run: 'pnpm run',
		exec: 'pnpm exec',
	},
	npm: {
		setup: `      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
`,
		install: 'npm ci',
		run: 'npm run',
		exec: 'npx --no-install',
	},
	yarn: {
		setup: `      - run: corepack enable

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: yarn
`,
		install: 'yarn install --immutable',
		run: 'yarn run',
		exec: 'yarn',
	},
	bun: {
		setup: `      - uses: oven-sh/setup-bun@v2
`,
		install: 'bun install --frozen-lockfile',
		run: 'bun run',
		exec: 'bunx',
	},
} as const;

/** The package manager's steps, with pnpm pinned where package.json does not. */
function tooling(options: TemplateOptions) {
	const pm = TOOLING[options.packageManager];
	return {
		...pm,
		setup: pm.setup.replace(
			'PNPM_VERSION\n',
			options.monorepo ? '' : '        with:\n          version: 10\n',
		),
	};
}

function ci(options: TemplateOptions): string {
	const pm = tooling(options);

	return `name: CI

on:
  pull_request:
    branches: [main]

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  validate:
    name: Validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

${pm.setup}
      - name: Install
        run: ${pm.install}

      - name: Build
        run: ${pm.run} build

      - name: Lint
        run: ${pm.run} lint

      - name: Typecheck
        run: ${pm.run} typecheck

      # \`gkm test\` starts the containers the declared constructs need (the
      # runner has Docker) and, with GKM_AUTO_SETUP, generates throwaway
      # secrets for the test stage — there is no key to share with CI.
      - name: Test
        timeout-minutes: 15
        run: ${pm.run} test:once
        env:
          CI: true
          GKM_AUTO_SETUP: 1
`;
}

const releaseDrafterWorkflow = `name: Release Drafter

on:
  push:
    branches: [main]
  pull_request:
    types: [opened, reopened, synchronize, edited]

permissions:
  contents: read

jobs:
  draft:
    name: Update release draft
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: release-drafter/release-drafter@v6
        with:
          commitish: main
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

function releaseDrafterConfig(options: TemplateOptions): string {
	const mobile =
		options.frontendFramework === 'expo'
			? `  - title: "📱 Mobile"
    labels: [mobile, ios, android]
    collapse-after: 10
`
			: '';

	return `name-template: "v$RESOLVED_VERSION"
tag-template: "v$RESOLVED_VERSION"

categories:
  - title: "✨ New Features"
    labels: [feature, enhancement]
    collapse-after: 10
  - title: "🐛 Bug Fixes"
    labels: [bug, fix]
    collapse-after: 10
${mobile}  - title: "🏗 Infrastructure"
    labels: [infrastructure, ci]
    collapse-after: 10
  - title: "📦 Dependencies"
    labels: [dependencies]
    collapse-after: 5
  - title: "🔒 Security"
    labels: [security]
  - title: "🧹 Maintenance"
    labels: [chore, refactor]
    collapse-after: 5

change-template: "- $TITLE @$AUTHOR (#$NUMBER)"
change-title-escapes: '\\<*_&'

version-resolver:
  major:
    labels: [breaking-change, major]
  minor:
    labels: [feature, enhancement, minor]
  patch:
    labels: [bug, fix, chore, dependencies, patch]
  default: patch

# Labelled from the conventional-commit prefix of the pull request title.
autolabeler:
  - label: feature
    title: ["/^feat/i"]
  - label: bug
    title: ["/^fix/i"]
  - label: chore
    title: ["/^chore/i", "/^refactor/i"]
  - label: dependencies
    title: ["/^deps/i", "/^chore\\\\(deps\\\\)/i"]
  - label: ci
    title: ["/^ci/i"]
  - label: breaking-change
    title: ["/^\\\\w+(\\\\(.+\\\\))?!:/"]

template: |
  ## What's Changed

  $CHANGES

  **Full Changelog**: https://github.com/$OWNER/$REPOSITORY/compare/$PREVIOUS_TAG...v$RESOLVED_VERSION
`;
}

/**
 * What every deploy workflow starts with: its triggers, and the `stages` job,
 * which asks the project's own gkm (through the stages action) which stages
 * this run builds and deploys. Nothing in a workflow names a stage.
 */
function deployHeader(build: boolean): string {
	const push = build
		? 'builds every deployed stage, deploys those not protected'
		: 'every deployed stage that is not protected';
	return `name: Deploy

# Which stages exist, and which are protected, is read from \`stages\` in
# gkm.config.ts by the project's own gkm, through the stages action — nothing
# here names one:
#
#   push to main       ${push}
#   release published  the protected stages (publish the drafted release)
#   run workflow       the one stage you name, at the ref you name
on:
  push:
    branches: [main]
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      stage:
        description: A deployed stage from gkm.config.ts
        required: true
        type: string
      ref:
        description: The commit, tag or branch to deploy (default the latest on main)
        required: false
        type: string

permissions:
  contents: read
`;
}

function stagesJob(options: TemplateOptions): string {
	const pm = tooling(options);
	return `  stages:
    name: Pick stages
    runs-on: ubuntu-latest
    outputs:
      build: \${{ steps.stages.outputs.build }}
      deploy: \${{ steps.stages.outputs.deploy }}
      has-build: \${{ steps.stages.outputs.has-build }}
      has-deploy: \${{ steps.stages.outputs.has-deploy }}
      aws-region: \${{ steps.stages.outputs.aws-region }}
      resources: \${{ steps.stages.outputs.resources }}
    steps:
      - uses: actions/checkout@v4

${pm.setup}
      - name: Install
        run: ${pm.install}

      # Runs \`gkm stages --github-output\`: the rules for each event are the
      # installed CLI's, and a manual run naming a stage gkm.config.ts does not
      # deploy fails here.
      - name: Read stages from gkm.config.ts
        id: stages
        uses: ${stagesActionUses()}
        with:
          stage: \${{ inputs.stage }}
`;
}

/** Every step in `steps` run only when `condition` holds. */
function onlyIf(steps: string, condition: string): string {
	return steps.replace(/^ {6}- /gm, `      - if: ${condition}\n        `);
}

/**
 * The registry login a compose build pushes with: GitHub's own token on
 * ghcr.io, otherwise a username variable and a password secret.
 */
function registryLogin(registry: string): string {
	const host = registry.split('/')[0]!;
	const ghcr = host === 'ghcr.io';
	return `      - uses: docker/login-action@v3
        with:
          registry: ${host}
          username: ${ghcr ? '${{ github.actor }}' : '${{ vars.REGISTRY_USERNAME }}'}
          password: ${ghcr ? '${{ secrets.GITHUB_TOKEN }}' : '${{ secrets.REGISTRY_PASSWORD }}'}
`;
}

/**
 * The compose deploy: images are built and pushed by the runner, where the
 * code is, and pulled by the server, where the stage runs.
 *
 * - `build` (on a push): every deployed stage's images, tagged with the
 *   commit, and their digests kept as the artifact `digests-<stage>`.
 * - `deploy`: the commit the event names — a release's tag, a manual run's
 *   `ref` — then that commit's push build, whose digests pin each image. Over
 *   SSH, with a pinned host key, the server checks the commit out and runs
 *   `gkm compose` on exactly those images.
 * - Resources: where the stage has some the deploy creates — a provider's
 *   bucket and key, DNS records through a provider — the runner creates them
 *   first (`gkm deploy --resources-only`) with the stage's role and the DNS
 *   token from its environment, and the server deploys with
 *   `--skip-resources`: neither credential reaches the server.
 */
function composeDeploy(options: TemplateOptions): string {
	const pm = tooling(options);
	const registry = options.registry ?? '';

	return `${deployHeader(true)}
jobs:
${stagesJob(options)}
  build:
    name: Build \${{ matrix.stage }}
    needs: stages
    if: needs.stages.outputs.has-build == 'true'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        stage: \${{ fromJSON(needs.stages.outputs.build) }}
    # One GitHub environment per stage: its secrets, variables and approvals.
    environment: \${{ matrix.stage }}
    permissions:
      contents: read
      packages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4

${pm.setup}
      - name: Install
        run: ${pm.install}

${registryLogin(registry)}
      # A site's public URLs are built into it, so the build reads the stage's
      # secrets store. With secrets.store on SSM or Secrets Manager the job
      # assumes the stage's role (AWS_ROLE_ARN, set by gkm deploy:github);
      # with the default 'file' store there is no role to assume.
      - name: Assume the stage's AWS role
        if: needs.stages.outputs.aws-region != ''
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ vars.AWS_ROLE_ARN }}
          aws-region: \${{ needs.stages.outputs.aws-region }}

      # Builds and pushes every image the stage runs, tagged with the commit,
      # and starts nothing.
      - name: Build and push
        run: ${pm.exec} gkm compose --stage "$STAGE" --build --push --tag "$SHA" --digests-file digests.json
        env:
          STAGE: \${{ matrix.stage }}
          SHA: \${{ github.sha }}

      # What each tag pointed at when it was pushed. A deploy runs these
      # digests, so a tag moved since cannot change what is released.
      - uses: actions/upload-artifact@v4
        with:
          name: digests-\${{ matrix.stage }}
          path: digests.json
          retention-days: 90

  deploy:
    name: Deploy \${{ matrix.stage }}
    needs: [stages, build]
    # The build is skipped on a release or a manual run: deploy then anyway,
    # but never after a failed build.
    if: \${{ !cancelled() && !failure() && needs.stages.outputs.has-deploy == 'true' }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        stage: \${{ fromJSON(needs.stages.outputs.deploy) }}
    environment: \${{ matrix.stage }}
    concurrency:
      group: deploy-\${{ matrix.stage }}
      cancel-in-progress: false
    permissions:
      contents: read
      actions: read
      id-token: write
    env:
      # Whether the stage has resources the deploy creates — a provider's
      # bucket and key (deploy.<kind>.<stage>), DNS records through a provider
      # in dns: the runner creates them with the stage's role and DNS token,
      # so neither reaches the server, which deploys with --skip-resources.
      RESOURCES_ON_RUNNER: \${{ contains(fromJSON(needs.stages.outputs.resources || '[]'), matrix.stage) }}
    steps:
      # A release deploys its tag's commit, never its target_commitish — the
      # branch it was drafted against, which has moved on since.
      - name: Resolve the commit
        id: commit
        run: |
          case "$EVENT" in
            release) ref="tags/$TAG" ;;
            workflow_dispatch) ref="\${REF:-$SHA}" ;;
            *) ref="$SHA" ;;
          esac
          sha=$(gh api "repos/$REPO/commits/$ref" --jq .sha)
          echo "Deploying $sha"
          echo "sha=$sha" >> "$GITHUB_OUTPUT"
        env:
          GH_TOKEN: \${{ github.token }}
          REPO: \${{ github.repository }}
          EVENT: \${{ github.event_name }}
          TAG: \${{ github.event.release.tag_name }}
          REF: \${{ inputs.ref }}
          SHA: \${{ github.sha }}

      # The deploy's resources, here on the runner: each provider's bucket
      # and key (written into the stage's secrets store), and every public
      # host's DNS record — a new app's included, one per host, never a
      # wildcard — written through the provider where it is missing or out of
      # date and read back from it. The stage's secrets (GKM_SERVER_IPV4
      # among them) are read with the stage's role; the DNS token is a secret
      # on this stage's environment. A missing credential fails here, before
      # anything is deployed.
      - name: Check out the commit
        if: env.RESOURCES_ON_RUNNER == 'true'
        uses: actions/checkout@v4
        with:
          ref: \${{ steps.commit.outputs.sha }}

${onlyIf(pm.setup, "env.RESOURCES_ON_RUNNER == 'true'")}
      - name: Install
        if: env.RESOURCES_ON_RUNNER == 'true'
        run: ${pm.install}

      - name: Assume the stage's AWS role
        if: env.RESOURCES_ON_RUNNER == 'true' && needs.stages.outputs.aws-region != ''
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ vars.AWS_ROLE_ARN }}
          aws-region: \${{ needs.stages.outputs.aws-region }}

      - name: Create the stage's resources
        if: env.RESOURCES_ON_RUNNER == 'true'
        run: ${pm.exec} gkm deploy --stage "$STAGE" --resources-only
        env:
          STAGE: \${{ matrix.stage }}
          GODADDY_API_TOKEN: \${{ secrets.GODADDY_API_TOKEN }}
          HOSTINGER_API_TOKEN: \${{ secrets.HOSTINGER_API_TOKEN }}

      # The push run of this workflow that built the commit for this stage:
      # this run on a push, the newest one with the stage's digests otherwise.
      - name: Find the commit's push build
        id: build
        run: |
          if [ "$EVENT" = push ]; then
            echo "run-id=$RUN_ID" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          workflow=\${WORKFLOW_REF%%@*}
          workflow=\${workflow##*/}
          for id in $(gh run list --repo "$REPO" --workflow "$workflow" --event push --commit "$SHA" --limit 20 --json databaseId --jq '.[].databaseId'); do
            found=$(gh api "repos/$REPO/actions/runs/$id/artifacts?name=$ARTIFACT" --jq '[.artifacts[] | select(.expired | not)] | length')
            if [ "$found" -gt 0 ]; then
              echo "run-id=$id" >> "$GITHUB_OUTPUT"
              exit 0
            fi
          done
          echo "run-id=" >> "$GITHUB_OUTPUT"
        env:
          GH_TOKEN: \${{ github.token }}
          REPO: \${{ github.repository }}
          EVENT: \${{ github.event_name }}
          RUN_ID: \${{ github.run_id }}
          WORKFLOW_REF: \${{ github.workflow_ref }}
          SHA: \${{ steps.commit.outputs.sha }}
          ARTIFACT: digests-\${{ matrix.stage }}

      - name: Download digests-\${{ matrix.stage }}
        if: steps.build.outputs.run-id != ''
        uses: actions/download-artifact@v4
        with:
          name: digests-\${{ matrix.stage }}
          run-id: \${{ steps.build.outputs.run-id }}
          github-token: \${{ github.token }}

      - name: No digests — deploying by tag
        if: steps.build.outputs.run-id == ''
        run: |
          echo "::warning title=$STAGE deploys by tag, not digest::No push build of $SHA kept digests-$STAGE (never built, or older than 90 days). The server runs whatever the tag $SHA points at in the registry now, which anyone who can push there could have replaced."
        env:
          STAGE: \${{ matrix.stage }}
          SHA: \${{ steps.commit.outputs.sha }}

      # Each environment holds DEPLOY_SSH_KEY (secret) and DEPLOY_KNOWN_HOSTS,
      # DEPLOY_HOST, DEPLOY_USER and DEPLOY_PATH (variables): the server's
      # host key is pinned, never accepted on first sight. DEPLOY_PATH is a
      # clone of this repository, with a docker login to ${registry.split('/')[0]}
      # and the stage's secrets.
      #
      # Every value reaches the server as an argument to a quoted heredoc —
      # nothing is pasted into the script.
      - name: Deploy on the server
        run: |
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          (umask 077 && printf '%s\\n' "$SSH_KEY" > ~/.ssh/deploy_key)
          printf '%s\\n' "$KNOWN_HOSTS" > ~/.ssh/known_hosts
          digests=""
          if [ -f digests.json ]; then digests=$(base64 -w0 < digests.json); fi
          ssh -i ~/.ssh/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \\
            "$DEPLOY_USER@$DEPLOY_HOST" \\
            "bash -s -- $(printf '%q ' "$STAGE" "$SHA" "$DEPLOY_PATH" "$digests" "$RESOURCES_ON_RUNNER")" <<'REMOTE'
          set -euo pipefail
          stage=$1 sha=$2 dir=$3 digests=$4 resources_on_runner=$5
          cd "$dir"
          git fetch --quiet origin
          git checkout --quiet --detach "$sha"
          ${pm.install}
          args=(--stage "$stage" --tag "$sha")
          if [ -n "$digests" ]; then
            mkdir -p .gkm
            printf '%s' "$digests" | base64 -d > ".gkm/digests-$stage.json"
            args+=(--digests-file ".gkm/digests-$stage.json")
          fi
          # Created and confirmed from the runner already.
          if [ "$resources_on_runner" = true ]; then args+=(--skip-resources); fi
          ${pm.exec} gkm compose "\${args[@]}"
          REMOTE
        env:
          SSH_KEY: \${{ secrets.DEPLOY_SSH_KEY }}
          KNOWN_HOSTS: \${{ vars.DEPLOY_KNOWN_HOSTS }}
          DEPLOY_HOST: \${{ vars.DEPLOY_HOST }}
          DEPLOY_USER: \${{ vars.DEPLOY_USER }}
          DEPLOY_PATH: \${{ vars.DEPLOY_PATH }}
          STAGE: \${{ matrix.stage }}
          SHA: \${{ steps.commit.outputs.sha }}
`;
}

/**
 * Dokploy and SST: `gkm deploy` builds, releases and health-checks a stage in
 * one step, from a checkout, so there is no separate build job — the stages
 * job's `deploy` list is the matrix, and `build` goes unused.
 */
function targetDeploy(options: TemplateOptions): string {
	const pm = tooling(options);
	const sst = options.deployTarget === 'sst';

	const credentials = sst
		? `
      # An IAM role GitHub assumes through OIDC — no long-lived AWS keys. Set
      # AWS_ROLE_ARN as a variable on each environment.
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ vars.AWS_ROLE_ARN }}
          aws-region: ${options.region}
`
		: '';

	// A stage's secrets are read from its store by the deploy itself. SSM and
	// Secrets Manager need nothing but the role the job already assumed; the
	// local file needs its key, and the encrypted file itself, which a checkout
	// of an ignored `.gkm/` lacks.
	// Where the CLI looks for the stage's key: under the project's identity,
	// not under the checkout's folder name, which on a runner is the repo's.
	const keyDir = `~/.gkm/keys/${projectKey({ name: options.name })}`;
	const stageSecrets = sst
		? credentials
		: `
      # The stage's secrets are kept in the encrypted .gkm/secrets/<stage>.json,
      # and each environment holds its key as GKM_SECRETS_KEY. .gkm/ is
      # gitignored, so a checkout has the key but not the file: set
      # secrets.store in gkm.config.ts to a store CI can reach before deploying
      # from here.
      # Owner-only, as the CLI writes its own keys. The stage reaches the shell
      # as a variable, never pasted into the script: on a manual run it is
      # whatever was typed.
      - name: Stage secrets key
        run: |
          mkdir -p ${keyDir} && chmod 700 ${keyDir}
          (umask 077 && printf '%s' "$KEY" > ${keyDir}/"$STAGE".key)
        env:
          KEY: \${{ secrets.GKM_SECRETS_KEY }}
          STAGE: \${{ matrix.stage }}
`;

	// The deploy writes each app's DNS records through the provider in
	// gkm.config.ts's \`dns\`; its token is a secret on the stage's
	// environment (empty, and unused, without one).
	const deployEnv = sst
		? ''
		: `
          DOKPLOY_API_TOKEN: \${{ secrets.DOKPLOY_API_TOKEN }}
          DOKPLOY_ENDPOINT: \${{ vars.DOKPLOY_ENDPOINT }}
          GODADDY_API_TOKEN: \${{ secrets.GODADDY_API_TOKEN }}
          HOSTINGER_API_TOKEN: \${{ secrets.HOSTINGER_API_TOKEN }}`;

	return `${deployHeader(false)}
jobs:
${stagesJob(options)}
  deploy:
    name: Deploy \${{ matrix.stage }}
    needs: stages
    if: needs.stages.outputs.has-deploy == 'true'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        stage: \${{ fromJSON(needs.stages.outputs.deploy) }}
    # One GitHub environment per stage: its secrets and variables, and any
    # approval rule you put on a protected one.
    environment: \${{ matrix.stage }}
    concurrency:
      group: deploy-\${{ matrix.stage }}
      cancel-in-progress: false
    permissions:
      contents: read${sst ? '\n      id-token: write' : ''}
    steps:
      # The event's own commit — a release's tag, the push — or the ref a
      # manual run names.
      - uses: actions/checkout@v4
        with:
          ref: \${{ inputs.ref }}

${pm.setup}
      - name: Install
        run: ${pm.install}
${stageSecrets}
      # Builds, releases and health-checks the stage through deploy.default
      # in gkm.config.ts, and fails the job if any of it fails.
      - name: Deploy
        run: ${pm.exec} gkm deploy --stage "$STAGE"
        env:
          STAGE: \${{ matrix.stage }}${deployEnv}
`;
}

function deploy(options: TemplateOptions): string {
	return options.deployTarget === 'compose'
		? composeDeploy(options)
		: targetDeploy(options);
}

export function generateGithubFiles(options: TemplateOptions): GeneratedFile[] {
	const files: GeneratedFile[] = [
		{ path: '.github/workflows/ci.yml', content: ci(options) },
		{
			path: '.github/workflows/release-drafter.yml',
			content: releaseDrafterWorkflow,
		},
		{
			path: '.github/release-drafter.yml',
			content: releaseDrafterConfig(options),
		},
	];

	// Only where a target was picked, and only for a workspace scaffold: the
	// one whose gkm.config.ts says where its stages deploy.
	if (options.monorepo && options.deployTarget !== 'none') {
		files.push({
			path: '.github/workflows/deploy.yml',
			content: deploy(options),
		});
	}

	return files;
}
