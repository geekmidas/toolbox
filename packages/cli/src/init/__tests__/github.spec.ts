import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { generateGithubFiles } from '../generators/github';
import type { TemplateOptions } from '../templates/index';

const workspace: TemplateOptions = {
	name: 'beetlefit',
	template: 'fullstack',
	monorepo: true,
	apiPath: 'apps/api',
	telescope: true,
	studio: true,
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

	it('reads the stages from gkm.config.ts instead of naming them', () => {
		const deploy = files()['.github/workflows/deploy.yml']!;

		expect(deploy).toContain("import config from './gkm.config.ts'");
		expect(deploy).not.toMatch(/\b(staging|prod)\b/);
		expect(parse(deploy).on).toEqual({
			push: { branches: ['main'] },
			release: { types: ['published'] },
			workflow_dispatch: {
				inputs: {
					stage: {
						description: 'A deployed stage from gkm.config.ts',
						required: true,
					},
				},
			},
		});
	});

	it('deploys each stage in its own environment, never pasting the stage into a script', () => {
		const job = parse(files()['.github/workflows/deploy.yml']!).jobs.deploy;

		expect(job.environment).toBe('${{ matrix.stage }}');
		for (const step of job.steps as { run?: string }[]) {
			expect(step.run ?? '').not.toContain('${{');
		}
	});

	it('pulls an SST stage’s secrets from SSM once the role is assumed', () => {
		const job = parse(files()['.github/workflows/deploy.yml']!).jobs.deploy;
		const names = job.steps.map(
			(s: { name?: string; uses?: string }) => s.name ?? s.uses,
		);
		const pull = job.steps.find(
			(s: { name?: string }) => s.name === 'Stage secrets',
		);

		expect(pull.run).toBe('pnpm exec gkm secrets:pull --stage "$STAGE"');
		expect(pull.env).toEqual({ STAGE: '${{ matrix.stage }}' });
		expect(names.indexOf('Stage secrets')).toBeGreaterThan(
			names.indexOf('aws-actions/configure-aws-credentials@v4'),
		);
		expect(names.indexOf('Stage secrets')).toBeLessThan(
			names.indexOf('Deploy'),
		);
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

		expect(key.run).toContain('~/.gkm/beetlefit/"$STAGE".key');
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

	it('hands Dokploy its token and endpoint', () => {
		const job = parse(
			files({ deployTarget: 'dokploy', region: undefined })[
				'.github/workflows/deploy.yml'
			]!,
		).jobs.deploy;
		const deploy = job.steps.at(-1);

		expect(deploy.run).toBe('pnpm run "deploy:$STAGE"');
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
		// Only the workspace scaffold writes `deploy:<stage>` scripts.
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
});
