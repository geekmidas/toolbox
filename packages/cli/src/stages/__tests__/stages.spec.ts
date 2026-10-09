import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { InvalidStages, UndeclaredStage } from '../../workspace/stages';
import {
	DispatchNamesNoStage,
	GithubEventNotSet,
	GithubOutputNotSet,
	stagesCommand,
} from '../index';

const bin = join(import.meta.dirname, '..', '..', '..', 'bin', 'gkm.mjs');

/** A workspace config, with `stages` and whatever else `extra` adds. */
const config = (stages: string | null, extra = '') => `
export default {
  name: 'shop',
  ${stages === null ? '' : `stages: ${stages},`}
  ${extra}
  apps: {},
};
`;

const LOCAL_ONLY = `{ local: 'dev', deployed: [] }`;
const DEPLOYED = `{ local: 'dev', deployed: ['staging', 'prod'], protected: ['prod'] }`;

describe('gkm stages', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await createTempDir('gkm-stages-');
	});

	afterEach(async () => {
		await cleanupDir(dir);
	});

	async function run(
		options: Parameters<typeof stagesCommand>[0],
		env: NodeJS.ProcessEnv = {},
	) {
		const lines: string[] = [];
		await stagesCommand(options, {
			cwd: dir,
			env,
			log: (line) => lines.push(line),
		});
		return lines;
	}

	describe('--json', () => {
		it('prints a workspace with only a local stage', async () => {
			await writeFile(join(dir, 'gkm.config.ts'), config(LOCAL_ONLY));

			expect(JSON.parse((await run({ json: true })).join(''))).toEqual({
				local: 'dev',
				deployed: [],
				protected: [],
			});
		});

		it('prints the deployed and protected stages', async () => {
			await writeFile(join(dir, 'gkm.config.ts'), config(DEPLOYED));

			expect(await run({ json: true })).toEqual([
				'{"local":"dev","deployed":["staging","prod"],"protected":["prod"]}',
			]);
		});

		it('refuses a config without stages, by name', async () => {
			await writeFile(join(dir, 'gkm.config.ts'), config(null));

			await expect(run({ json: true })).rejects.toThrow(InvalidStages);
			await expect(run({ json: true })).rejects.toThrow('`stages` is required');
		});

		it('prints only the JSON on stdout from the built program', async () => {
			await writeFile(join(dir, 'gkm.config.ts'), config(DEPLOYED));

			const stdout = execFileSync(
				process.execPath,
				[bin, '--cwd', dir, 'stages', '--json'],
				{ encoding: 'utf-8' },
			);

			expect(JSON.parse(stdout)).toEqual({
				local: 'dev',
				deployed: ['staging', 'prod'],
				protected: ['prod'],
			});
		});

		it('exits non-zero, naming the error, without stages', async () => {
			await writeFile(join(dir, 'gkm.config.ts'), config(null));

			const result = spawnSync(
				process.execPath,
				[bin, '--cwd', dir, 'stages', '--json'],
				{ encoding: 'utf-8' },
			);

			expect(result.status).toBe(1);
			expect(result.stdout).toBe('');
			expect(result.stderr).toContain('InvalidStages');
		});
	});

	it('prints a table without --json', async () => {
		await writeFile(join(dir, 'gkm.config.ts'), config(DEPLOYED));

		expect((await run({})).join('\n')).toBe(
			[
				'STAGE    KIND',
				'dev      local',
				'staging  deployed',
				'prod     deployed, protected',
			].join('\n'),
		);
	});

	describe('--github-output', () => {
		const outputFile = () => join(dir, 'github-output');

		async function outputs(
			options: Parameters<typeof stagesCommand>[0],
			env: NodeJS.ProcessEnv = {},
		) {
			await writeFile(outputFile(), '');
			await run(
				{ githubOutput: true, ...options },
				{ GITHUB_OUTPUT: outputFile(), ...env },
			);
			const text = await readFile(outputFile(), 'utf-8');
			return Object.fromEntries(
				text
					.trimEnd()
					.split('\n')
					.map((line) => {
						const at = line.indexOf('=');
						return [line.slice(0, at), line.slice(at + 1)];
					}),
			);
		}

		it('writes every output, each a JSON string, for a push', async () => {
			await writeFile(join(dir, 'gkm.config.ts'), config(DEPLOYED));

			expect(await outputs({}, { GITHUB_EVENT_NAME: 'push' })).toEqual({
				local: '"dev"',
				deployed: '["staging","prod"]',
				protected: '["prod"]',
				build: '["staging","prod"]',
				deploy: '["staging"]',
				'has-build': 'true',
				'has-deploy': 'true',
				'aws-region': '',
				resources: '[]',
			});
		});

		it('takes --event over GITHUB_EVENT_NAME', async () => {
			await writeFile(join(dir, 'gkm.config.ts'), config(DEPLOYED));

			const written = await outputs(
				{ event: 'release' },
				{ GITHUB_EVENT_NAME: 'push' },
			);

			expect(written.build).toBe('[]');
			expect(written.deploy).toBe('["prod"]');
			expect(written['has-build']).toBe('false');
			expect(written['has-deploy']).toBe('true');
		});

		it('says there is nothing to deploy for a project with no deployed stage', async () => {
			await writeFile(join(dir, 'gkm.config.ts'), config(LOCAL_ONLY));

			const written = await outputs({ event: 'push' });

			expect(written['has-build']).toBe('false');
			expect(written['has-deploy']).toBe('false');
		});

		it('names the AWS secrets store’s region, so a job knows to assume a role', async () => {
			await writeFile(
				join(dir, 'gkm.config.ts'),
				config(
					DEPLOYED,
					`secrets: { store: { provider: 'ssm', region: 'af-south-1' } },`,
				),
			);

			expect((await outputs({ event: 'push' }))['aws-region']).toBe(
				'af-south-1',
			);
		});

		it('names the stages whose resources the deploy creates on a runner', async () => {
			await writeFile(
				join(dir, 'gkm.config.ts'),
				config(
					`{ local: 'dev', deployed: ['staging', 'prod', 'preview', 'demo'] }`,
					`secrets: { store: { provider: 'ssm', region: 'af-south-1' } },
  domains: {
    staging: 'staging.example.org',
    prod: 'example.com',
    preview: 'preview.example.org',
    demo: 'demo.example.org',
  },
  dns: {
    'example.com': { provider: 'godaddy' },
    'example.org': { provider: 'manual' },
  },
  deploy: { objects: { preview: { provider: 's3', region: 'af-south-1' } } },`,
				),
			);

			// prod: DNS through GoDaddy; preview: an s3 provider; staging and
			// demo: manual DNS, keys set by hand — nothing to create.
			expect((await outputs({ event: 'push' })).resources).toBe(
				'["prod","preview"]',
			);
		});

		it('names none when the secrets are not where a runner can reach them', async () => {
			await writeFile(
				join(dir, 'gkm.config.ts'),
				config(
					DEPLOYED,
					`domains: { prod: 'example.com' },
  dns: { 'example.com': { provider: 'godaddy' } },`,
				),
			);

			expect((await outputs({ event: 'push' })).resources).toBe('[]');
		});

		it('annotates the run and writes nothing for a dispatch to an unknown stage', async () => {
			await writeFile(join(dir, 'gkm.config.ts'), config(DEPLOYED));
			await writeFile(outputFile(), '');
			const lines: string[] = [];

			await expect(
				stagesCommand(
					{ githubOutput: true, event: 'workflow_dispatch', stage: 'qa' },
					{
						cwd: dir,
						env: { GITHUB_OUTPUT: outputFile() },
						log: (line) => lines.push(line),
					},
				),
			).rejects.toThrow(UndeclaredStage);

			expect(lines).toEqual([
				'::error title=gkm stages::"qa" is not a deployed stage. gkm.config.ts deploys to: staging, prod.',
			]);
			expect(await readFile(outputFile(), 'utf-8')).toBe('');
		});

		it('refuses a dispatch with no stage', async () => {
			await writeFile(join(dir, 'gkm.config.ts'), config(DEPLOYED));
			await writeFile(outputFile(), '');

			await expect(
				run(
					{ githubOutput: true, event: 'workflow_dispatch' },
					{ GITHUB_OUTPUT: outputFile() },
				),
			).rejects.toThrow(DispatchNamesNoStage);
		});

		it('needs GITHUB_OUTPUT and an event', async () => {
			await writeFile(join(dir, 'gkm.config.ts'), config(DEPLOYED));

			await expect(run({ githubOutput: true, event: 'push' })).rejects.toThrow(
				GithubOutputNotSet,
			);
			await writeFile(outputFile(), '');
			await expect(
				run({ githubOutput: true }, { GITHUB_OUTPUT: outputFile() }),
			).rejects.toThrow(GithubEventNotSet);
		});

		it('escapes a multi-line message into one annotation', async () => {
			await writeFile(join(dir, 'gkm.config.ts'), config(null));
			await writeFile(outputFile(), '');
			const lines: string[] = [];

			await expect(
				stagesCommand(
					{ githubOutput: true, event: 'push' },
					{
						cwd: dir,
						env: { GITHUB_OUTPUT: outputFile() },
						log: (line) => lines.push(line),
					},
				),
			).rejects.toThrow(InvalidStages);

			expect(lines).toHaveLength(1);
			expect(lines[0]).toMatch(/^::error title=gkm stages::Invalid stages:%0A/);
		});
	});
});
