/**
 * The GitHub workflows a scaffold ships with.
 *
 * - `ci.yml` — every pull request builds, lints, typechecks and tests.
 * - `release-drafter.yml` — merged pull requests accumulate in a draft
 *   release, labelled from their titles.
 * - `deploy.yml` — when a deploy target was picked: a push to main deploys the
 *   stages that are not protected, publishing the drafted release deploys the
 *   protected ones.
 *
 * The deploy workflow names no stage. It reads `stages` from gkm.config.ts at
 * run time, so the config stays the one place stages are declared and a
 * workflow cannot fall out of step with it.
 */

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

function deploy(options: TemplateOptions): string {
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

	// A stage's secrets reach the runner through its store. SSM needs nothing
	// but the role the job already assumed; the local file needs its key, and
	// the encrypted file itself, which a checkout of an ignored `.gkm/` lacks.
	const stageSecrets = sst
		? `${credentials}
      # The stage's secrets, from SSM in the account the role belongs to —
      # pushed there once with \`gkm secrets:push --stage <stage> --profile …\`.
      # The stage reaches the shell as a variable, never pasted into the script:
      # on a manual run it is whatever was typed.
      - name: Stage secrets
        run: ${pm.exec} gkm secrets:pull --stage "$STAGE"
        env:
          STAGE: \${{ matrix.stage }}
`
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
          mkdir -p -m 700 ~/.gkm/${options.name}
          (umask 077 && printf '%s' "$KEY" > ~/.gkm/${options.name}/"$STAGE".key)
        env:
          KEY: \${{ secrets.GKM_SECRETS_KEY }}
          STAGE: \${{ matrix.stage }}
`;

	const deployEnv = sst
		? ''
		: `
          DOKPLOY_API_TOKEN: \${{ secrets.DOKPLOY_API_TOKEN }}
          DOKPLOY_ENDPOINT: \${{ vars.DOKPLOY_ENDPOINT }}`;

	return `name: Deploy

# Which stages exist, and which are protected, is read from \`stages\` in
# gkm.config.ts — nothing here names one:
#
#   push to main       every deployed stage that is not protected
#   release published  the protected stages (publish the drafted release)
#   run workflow       the one stage you name
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

permissions:
  contents: read
  id-token: write

jobs:
  stages:
    name: Pick stages
    runs-on: ubuntu-latest
    outputs:
      stages: \${{ steps.pick.outputs.stages }}
    steps:
      - uses: actions/checkout@v4

${pm.setup}
      - name: Install
        run: ${pm.install}

      - name: Read stages from gkm.config.ts
        id: pick
        run: |
          ${pm.exec} tsx -e "
            import config from './gkm.config.ts';
            const { deployed, protected: kept = [] } = config.stages;
            const event = process.env.EVENT;
            if (event === 'workflow_dispatch' && !deployed.includes(process.env.STAGE)) {
              console.error('Not a deployed stage: ' + process.env.STAGE + ' (deployed: ' + deployed.join(', ') + ')');
              process.exit(1);
            }
            const stages =
              event === 'workflow_dispatch' ? [process.env.STAGE]
              : event === 'release' ? kept
              : deployed.filter((stage) => !kept.includes(stage));
            console.log('stages=' + JSON.stringify(stages));
          " >> "$GITHUB_OUTPUT"
        env:
          EVENT: \${{ github.event_name }}
          STAGE: \${{ inputs.stage }}

  deploy:
    name: Deploy \${{ matrix.stage }}
    needs: stages
    if: needs.stages.outputs.stages != '[]'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        stage: \${{ fromJSON(needs.stages.outputs.stages) }}
    # One GitHub environment per stage: its secrets and variables, and any
    # approval rule you put on a protected one.
    environment: \${{ matrix.stage }}
    concurrency:
      group: deploy-\${{ matrix.stage }}
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4

${pm.setup}
      - name: Install
        run: ${pm.install}
${stageSecrets}
      - name: Deploy
        run: ${pm.run} "deploy:$STAGE"
        env:
          STAGE: \${{ matrix.stage }}${deployEnv}
`;
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

	// The deploy scripts it runs exist only where a target was picked, and
	// only a workspace scaffold writes them.
	if (options.monorepo && options.deployTarget !== 'none') {
		files.push({
			path: '.github/workflows/deploy.yml',
			content: deploy(options),
		});
	}

	return files;
}
