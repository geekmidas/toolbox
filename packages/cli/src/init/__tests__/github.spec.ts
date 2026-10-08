import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { generateGithubFiles } from '../generators/github';
import { STAGES_ACTION, stagesActionUses } from '../stagesAction';
import type { TemplateOptions } from '../templates/index';

const workspace: TemplateOptions = {
	name: 'shop',
	template: 'fullstack',
	monorepo: true,
	apiPath: 'apps/api',
	telescope: true,
	loggerType: 'pino',
	routesStructure: 'centralized-endpoints',
	packageManager: 'pnpm',
	deployTarget: 'sst',
	region: 'af-south-1',
	stages: { local: 'dev', deployed: ['staging', 'prod'], protected: ['prod'] },
	constructs: { database: true, cache: false, mail: false, uploads: false },
};

const files = (options: Partial<TemplateOptions> = {}) =>
	Object.fromEntries(
		generateGithubFiles({ ...workspace, ...options }).map((f) => [
			f.path,
			f.content,
		]),
	);

describe('generateGithubFiles', () => {
	it('writes CI, the release drafter, and a deploy workflow — all valid YAML', () => {
		const written = files();

		expect(Object.keys(written).sort()).toEqual([
			'.github/release-drafter.yml',
			'.github/workflows/ci.yml',
			'.github/workflows/deploy.yml',
			'.github/workflows/release-drafter.yml',
		]);
		for (const content of Object.values(written)) {
			expect(() => parse(content)).not.toThrow();
		}
	});

	it('validates every pull request with the project’s own scripts', () => {
		const ci = parse(files()['.github/workflows/ci.yml']!);
		const runs = ci.jobs.validate.steps
			.map((step: { run?: string }) => step.run)
			.filter(Boolean);

		expect(ci.on).toEqual({ pull_request: { branches: ['main'] } });
		expect(runs).toEqual([
			'pnpm install --frozen-lockfile',
			'pnpm run build',
			'pnpm run lint',
			'pnpm run typecheck',
			'pnpm run test:once',
		]);
		// gkm test makes throwaway test secrets: there is no key to share.
		expect(ci.jobs.validate.steps.at(-1).env.GKM_AUTO_SETUP).toBe(1);
	});

	it.each([
		['npm', 'npm ci', 'npm run build'],
		['yarn', 'yarn install --immutable', 'yarn run build'],
		['bun', 'bun install --frozen-lockfile', 'bun run build'],
	] as const)('sets up and runs %s', (packageManager, install, build) => {
		const ci = files({ packageManager })['.github/workflows/ci.yml']!;

		expect(ci).toContain(install);
		expect(ci).toContain(build);
		expect(ci).not.toContain('pnpm');
	});

	it('pins pnpm only where package.json does not', () => {
		// The workspace root pins `packageManager`; the action refuses both.
		expect(files()['.github/workflows/ci.yml']).not.toContain('version: 10');
		expect(
			files({ monorepo: false, template: 'api', deployTarget: 'none' })[
				'.github/workflows/ci.yml'
			],
		).toContain('version: 10');
	});

	it('asks the stages action, not a script, which stages to deploy', () => {
		const deploy = files()['.github/workflows/deploy.yml']!;
		const workflow = parse(deploy);
		const pick = workflow.jobs.stages.steps.at(-1);

		expect(deploy).not.toContain("gkm.config.ts'");
		expect(deploy).not.toContain('tsx');
		expect(deploy).not.toMatch(/\b(staging|prod)\b/);
		expect(pick.uses).toMatch(/^geekmidas\/toolbox\/actions\/stages@/);
		expect(pick.with).toEqual({ stage: '${{ inputs.stage }}' });
		expect(workflow.on).toEqual({
			push: { branches: ['main'] },
			release: { types: ['published'] },
			workflow_dispatch: {
				inputs: {
					stage: {
						description: 'A deployed stage from gkm.config.ts',
						required: true,
						type: 'string',
					},
					ref: {
						description:
							'The commit, tag or branch to deploy (default the latest on main)',
						required: false,
						type: 'string',
					},
				},
			},
		});
	});

	it('deploys the matrix the action hands it, and skips an empty one', () => {
		const job = parse(files()['.github/workflows/deploy.yml']!).jobs.deploy;

		expect(job.needs).toBe('stages');
		expect(job.if).toBe("needs.stages.outputs.has-deploy == 'true'");
		expect(job.strategy.matrix.stage).toBe(
			'${{ fromJSON(needs.stages.outputs.deploy) }}',
		);
		expect(job.steps[0]).toEqual({
			uses: 'actions/checkout@v4',
			with: { ref: '${{ inputs.ref }}' },
		});
	});

	it('deploys each stage in its own environment, never pasting the stage into a script', () => {
		const job = parse(files()['.github/workflows/deploy.yml']!).jobs.deploy;

		expect(job.environment).toBe('${{ matrix.stage }}');
		for (const step of job.steps as { run?: string }[]) {
			expect(step.run ?? '').not.toContain('${{');
		}
	});

	it('leaves an SST stage’s secrets to the deploy, which reads SSM with the role', () => {
		const job = parse(files()['.github/workflows/deploy.yml']!).jobs.deploy;
		const steps = job.steps as { name?: string; run?: string }[];

		expect(steps.some((s) => s.run?.includes('secrets:pull'))).toBe(false);
		expect(JSON.stringify(job)).not.toContain('GKM_SECRETS_KEY');
	});

	it('hands a Dokploy stage its secrets key, and says the file is not there', () => {
		const deployYml = files({ deployTarget: 'dokploy', region: undefined })[
			'.github/workflows/deploy.yml'
		]!;
		const job = parse(deployYml).jobs.deploy;
		const key = job.steps.find(
			(s: { name?: string }) => s.name === 'Stage secrets key',
		);

		// Under the project's identity, wherever the runner checks it out.
		expect(key.run).toContain('~/.gkm/keys/shop/shop/"$STAGE".key');
		expect(key.env.KEY).toBe('${{ secrets.GKM_SECRETS_KEY }}');
		expect(deployYml).toContain('.gkm/ is\n      # gitignored');
		expect(deployYml).toContain('secrets.store');
	});

	it('assumes an AWS role in the chosen region for SST', () => {
		const job = parse(files()['.github/workflows/deploy.yml']!).jobs.deploy;
		const aws = job.steps.find((s: { uses?: string }) =>
			s.uses?.startsWith('aws-actions/configure-aws-credentials'),
		);

		expect(aws.with).toEqual({
			'role-to-assume': '${{ vars.AWS_ROLE_ARN }}',
			'aws-region': 'af-south-1',
		});
	});

	it('deploys an SST stage with gkm deploy, after assuming the role', () => {
		const job = parse(files()['.github/workflows/deploy.yml']!).jobs.deploy;
		const steps = job.steps as { uses?: string; run?: string }[];
		const deploy = steps.at(-1)!;

		expect(deploy.run).toBe('pnpm exec gkm deploy --stage "$STAGE"');
		// The keys the role step exports are what the deploy acts with.
		expect(
			steps.findIndex((s) =>
				s.uses?.startsWith('aws-actions/configure-aws-credentials'),
			),
		).toBeLessThan(steps.length - 1);
		expect(JSON.stringify(job)).not.toContain('sst deploy');
	});

	it('hands Dokploy its token and endpoint', () => {
		const job = parse(
			files({ deployTarget: 'dokploy', region: undefined })[
				'.github/workflows/deploy.yml'
			]!,
		).jobs.deploy;
		const deploy = job.steps.at(-1);

		expect(deploy.run).toBe('pnpm exec gkm deploy --stage "$STAGE"');
		expect(deploy.env).toEqual({
			STAGE: '${{ matrix.stage }}',
			DOKPLOY_API_TOKEN: '${{ secrets.DOKPLOY_API_TOKEN }}',
			DOKPLOY_ENDPOINT: '${{ vars.DOKPLOY_ENDPOINT }}',
		});
		expect(JSON.stringify(job)).not.toContain('configure-aws-credentials');
	});

	it('writes no deploy workflow without a target or deploy scripts', () => {
		expect(files({ deployTarget: 'none' })).not.toHaveProperty(
			'.github/workflows/deploy.yml',
		);
		// Only the workspace scaffold says where its stages deploy.
		expect(files({ monorepo: false })).not.toHaveProperty(
			'.github/workflows/deploy.yml',
		);
	});

	it('adds a Mobile category only for an Expo app', () => {
		expect(files()['.github/release-drafter.yml']).not.toContain('Mobile');
		expect(
			files({ frontendFramework: 'expo' })['.github/release-drafter.yml'],
		).toContain('📱 Mobile');
	});

	describe('on a compose target', () => {
		const compose = (options: Partial<TemplateOptions> = {}) =>
			files({
				deployTarget: 'compose',
				region: undefined,
				registry: 'ghcr.io/acme',
				...options,
			})['.github/workflows/deploy.yml']!;

		it('builds every stage on a push, pushing to the registry by commit', () => {
			const job = parse(compose()).jobs.build;
			const steps = job.steps as {
				name?: string;
				uses?: string;
				run?: string;
				with?: Record<string, unknown>;
				env?: Record<string, string>;
				if?: string;
			}[];

			expect(job.if).toBe("needs.stages.outputs.has-build == 'true'");
			expect(job.strategy.matrix.stage).toBe(
				'${{ fromJSON(needs.stages.outputs.build) }}',
			);
			expect(job.environment).toBe('${{ matrix.stage }}');
			expect(job.permissions).toEqual({
				contents: 'read',
				packages: 'write',
				'id-token': 'write',
			});

			const build = steps.find((s) => s.name === 'Build and push')!;
			expect(build.run).toBe(
				'pnpm exec gkm compose --stage "$STAGE" --build --push --tag "$SHA" --digests-file digests.json',
			);
			expect(build.env).toEqual({
				STAGE: '${{ matrix.stage }}',
				SHA: '${{ github.sha }}',
			});

			const upload = steps.find((s) =>
				s.uses?.startsWith('actions/upload-artifact'),
			)!;
			expect(upload.with).toEqual({
				name: 'digests-${{ matrix.stage }}',
				path: 'digests.json',
				'retention-days': 90,
			});

			// The role only where the secrets are on AWS.
			const aws = steps.find((s) =>
				s.uses?.startsWith('aws-actions/configure-aws-credentials'),
			)!;
			expect(aws.if).toBe("needs.stages.outputs.aws-region != ''");
			expect(aws.with).toEqual({
				'role-to-assume': '${{ vars.AWS_ROLE_ARN }}',
				'aws-region': '${{ needs.stages.outputs.aws-region }}',
			});
		});

		it('logs in to ghcr.io with the workflow token, elsewhere with a secret', () => {
			const login = (yml: string) =>
				parse(yml).jobs.build.steps.find((s: { uses?: string }) =>
					s.uses?.startsWith('docker/login-action'),
				).with;

			expect(login(compose())).toEqual({
				registry: 'ghcr.io',
				username: '${{ github.actor }}',
				password: '${{ secrets.GITHUB_TOKEN }}',
			});
			expect(login(compose({ registry: 'registry.acme.dev/shop' }))).toEqual({
				registry: 'registry.acme.dev',
				username: '${{ vars.REGISTRY_USERNAME }}',
				password: '${{ secrets.REGISTRY_PASSWORD }}',
			});
		});

		it('deploys each stage once at a time, after a build that did not fail', () => {
			const job = parse(compose()).jobs.deploy;

			expect(job.needs).toEqual(['stages', 'build']);
			expect(job.if).toBe(
				"${{ !cancelled() && !failure() && needs.stages.outputs.has-deploy == 'true' }}",
			);
			expect(job.strategy.matrix.stage).toBe(
				'${{ fromJSON(needs.stages.outputs.deploy) }}',
			);
			expect(job.environment).toBe('${{ matrix.stage }}');
			expect(job.concurrency).toEqual({
				group: 'deploy-${{ matrix.stage }}',
				'cancel-in-progress': false,
			});
			expect(job.permissions).toEqual({ contents: 'read', actions: 'read' });
		});

		it('deploys a release’s tag, never its target_commitish', () => {
			const yml = compose();
			const resolve = parse(yml).jobs.deploy.steps.find(
				(s: { name?: string }) => s.name === 'Resolve the commit',
			);

			expect(yml).not.toContain('release.target_commitish');
			expect(resolve.run).toContain('release) ref="tags/$TAG"');
			expect(resolve.run).toContain('workflow_dispatch) ref="${REF:-$SHA}"');
			expect(resolve.env.TAG).toBe('${{ github.event.release.tag_name }}');
			expect(resolve.env.REF).toBe('${{ inputs.ref }}');
		});

		it('pins the images by the push build’s digests, warning loudly without them', () => {
			const steps = parse(compose()).jobs.deploy.steps as {
				name?: string;
				uses?: string;
				run?: string;
				if?: string;
				with?: Record<string, unknown>;
			}[];
			const download = steps.find((s) =>
				s.uses?.startsWith('actions/download-artifact'),
			)!;
			const warning = steps.find((s) => s.run?.includes('::warning'))!;

			expect(download.if).toBe("steps.build.outputs.run-id != ''");
			expect(download.with).toEqual({
				name: 'digests-${{ matrix.stage }}',
				'run-id': '${{ steps.build.outputs.run-id }}',
				'github-token': '${{ github.token }}',
			});
			expect(warning.if).toBe("steps.build.outputs.run-id == ''");
		});

		it('runs gkm compose on the server over SSH with a pinned host key', () => {
			const ssh = parse(compose()).jobs.deploy.steps.at(-1);

			expect(ssh.run).toContain('StrictHostKeyChecking=yes');
			expect(ssh.run).toContain("<<'REMOTE'");
			expect(ssh.run).toContain('git checkout --quiet --detach "$sha"');
			expect(ssh.run).toContain('pnpm install --frozen-lockfile');
			expect(ssh.run).toContain('pnpm exec gkm compose "${args[@]}"');
			expect(ssh.run).toContain('--digests-file');
			expect(ssh.env).toEqual({
				SSH_KEY: '${{ secrets.DEPLOY_SSH_KEY }}',
				KNOWN_HOSTS: '${{ vars.DEPLOY_KNOWN_HOSTS }}',
				DEPLOY_HOST: '${{ vars.DEPLOY_HOST }}',
				DEPLOY_USER: '${{ vars.DEPLOY_USER }}',
				DEPLOY_PATH: '${{ vars.DEPLOY_PATH }}',
				STAGE: '${{ matrix.stage }}',
				SHA: '${{ steps.commit.outputs.sha }}',
			});
		});

		it('never pastes an expression into a script', () => {
			const { jobs } = parse(compose());
			for (const job of Object.values(jobs) as {
				steps: { run?: string }[];
			}[]) {
				for (const step of job.steps) {
					expect(step.run ?? '').not.toContain('${{');
				}
			}
		});
	});

	describe.each([
		'compose',
		'dokploy',
		'sst',
	] as const)('the %s deploy workflow', (deployTarget) => {
		const yml = () =>
			files({
				deployTarget,
				registry: deployTarget === 'compose' ? 'ghcr.io/acme' : undefined,
				region: deployTarget === 'sst' ? 'af-south-1' : undefined,
			})['.github/workflows/deploy.yml']!;

		it('matches its snapshot', () => {
			expect(yml()).toMatchSnapshot();
		});

		// actionlint (and the shellcheck it bundles) on what is generated. It
		// runs in Docker, which CI's runner has.
		it.skipIf(!hasDocker())(
			'is clean under actionlint',
			{ timeout: 180_000 },
			() => {
				const dir = mkdtempSync(join(tmpdir(), 'gkm-actionlint-'));
				try {
					mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
					writeFileSync(join(dir, '.github', 'workflows', 'deploy.yml'), yml());
					const result = spawnSync(
						'docker',
						[
							'run',
							'--rm',
							'-v',
							`${dir}:/repo`,
							'-w',
							'/repo',
							ACTIONLINT,
							'-no-color',
							'.github/workflows/deploy.yml',
						],
						{ encoding: 'utf-8' },
					);
					expect(`${result.stdout}${result.stderr}`).toBe('');
					expect(result.status).toBe(0);
				} finally {
					rmSync(dir, { recursive: true, force: true });
				}
			},
		);
	});

	describe('the stages action ref', () => {
		it('pins a released CLI to the commit it was released from', () => {
			const sha = 'a'.repeat(40);

			expect(stagesActionUses(sha, '10.1.0')).toBe(
				`${STAGES_ACTION}@${sha} # @geekmidas/cli 10.1.0`,
			);
		});

		it('names main from a build that knows no released commit', () => {
			for (const commit of [undefined, '', 'HEAD', 'abc123']) {
				expect(stagesActionUses(commit, '10.1.0')).toMatch(
					new RegExp(`^${STAGES_ACTION}@main #`),
				);
			}
		});
	});
});

const ACTIONLINT = 'rhysd/actionlint:1.7.7';

function hasDocker(): boolean {
	try {
		execFileSync('docker', ['info'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}
