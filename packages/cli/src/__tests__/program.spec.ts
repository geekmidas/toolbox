import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const bin = join(import.meta.dirname, '..', '..', 'bin', 'gkm.mjs');

/**
 * The commander wiring is excluded from coverage — each action calls a function
 * tested on its own — so nothing else loads the program. A command that
 * registers an option twice makes commander throw while the program is being
 * built, which kills every `gkm` command, `--help` included: alpha.16 shipped
 * `init --region` twice and no scaffold could build.
 */
describe('the gkm program', () => {
	it('builds every command and prints its help', () => {
		const help = execFileSync(process.execPath, [bin, '--help'], {
			encoding: 'utf-8',
		});

		expect(help).toContain('Usage: gkm');
		expect(help).toContain('init');
	});

	it('lists each init option once', () => {
		const help = execFileSync(process.execPath, [bin, 'init', '--help'], {
			encoding: 'utf-8',
		});

		for (const flag of ['--region', '--deploy', '--stages']) {
			expect(help.split(flag).length - 1, flag).toBe(1);
		}
	});
});

/**
 * What a command prints when it fails: an error gkm raised on purpose is its
 * name and message — the answer, with no stack pointing into gkm — and exits
 * 1. `GKM_DEBUG=1` brings the stack back.
 */
describe('a command that fails on purpose', () => {
	let dir: string;

	beforeEach(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-program-')));
		// A deployed stage kept in SSM, and no AWS credentials to reach it.
		writeFileSync(
			join(dir, 'gkm.config.ts'),
			`export default {
  name: 'shop',
  stages: { local: 'dev', deployed: ['prod'] },
  secrets: { store: { provider: 'ssm', region: 'us-east-1' } },
};
`,
		);
	});

	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const run = (env: Record<string, string> = {}) => {
		const clean = Object.fromEntries(
			Object.entries(process.env).filter(([key]) => !key.startsWith('AWS_')),
		);
		return spawnSync(
			process.execPath,
			[bin, 'secrets:add', '--stage', 'prod', '--json', '--missing'],
			{
				cwd: dir,
				encoding: 'utf-8',
				env: {
					...clean,
					GKM_HOME: join(dir, '.gkm-home'),
					GKM_DEBUG: '',
					AWS_CONFIG_FILE: '/dev/null',
					AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
					AWS_EC2_METADATA_DISABLED: 'true',
					AWS_ENDPOINT_URL: 'http://127.0.0.1:1',
					...env,
				},
			},
		);
	};

	it('prints its name and message, without a stack, and exits 1', () => {
		const result = run();

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"StageSecretsUnreadable: The 'prod' stage's secrets are kept in SSM Parameter Store",
		);
		expect(result.stderr).not.toMatch(/\n\s+at /);
		expect(result.stdout).toBe('');
	});

	it('prints the stack with GKM_DEBUG=1', () => {
		const result = run({ GKM_DEBUG: '1' });

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('StageSecretsUnreadable');
		expect(result.stderr).toMatch(/\n\s+at /);
	});
});
