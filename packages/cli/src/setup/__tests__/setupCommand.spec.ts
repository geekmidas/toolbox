import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { readStageSecrets, writeStageSecrets } from '../../secrets/storage';

/**
 * `gkm setup` as a developer runs it: in a project, with its keys under a home
 * directory. The keys go to a temporary one, and nothing here starts a
 * container — the projects declare none, or pass `--skip-docker`.
 *
 * The SSM cases talk to the AWS emulator the suite already runs, through the
 * SDK's own `AWS_ENDPOINT_URL`, so push and pull are the real calls.
 */

const answers = vi.hoisted(() => ({ shouldPush: true }));

vi.mock('prompts', () => ({
	default: vi.fn(async () => answers),
}));

const { setupCommand } = await import('../index');

class Exited extends Error {
	constructor(readonly code: number | undefined) {
		super(`exit ${code}`);
	}
}

describe('setupCommand', () => {
	let dir: string;
	let cwd: string;
	let log: MockInstance;
	let error: MockInstance;
	let warn: MockInstance;

	const output = (spy: MockInstance) => spy.mock.calls.flat().join('\n');

	beforeEach(async () => {
		dir = realpathSync(await createTempDir('gkm-setup-'));
		cwd = process.cwd();
		process.chdir(dir);
		vi.stubEnv('HOME', dir);
		// Compose reads this from the environment; anything that reaches it from
		// here gets a project of its own, never a shared one.
		vi.stubEnv('COMPOSE_PROJECT_NAME', `gkm-spec-${Date.now()}`);
		answers.shouldPush = true;
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		error = vi.spyOn(console, 'error').mockImplementation(() => {});
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
			throw new Exited(code);
		}) as never);
	});

	afterEach(async () => {
		process.chdir(cwd);
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		await cleanupDir(dir);
	});

	/** A config file; `body` goes inside `defineWorkspace({ … })`. */
	function config(body: string, name = 'shop') {
		writeFileSync(
			join(dir, 'gkm.config.ts'),
			`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: '${name}',
  stages: { local: 'dev', deployed: ['prod'] },
  ${body}
});
`,
		);
	}

	const apps = `apps: {
    api: { type: 'backend', path: 'apps/api', port: 3400 },
    web: { type: 'web', path: 'apps/web', port: 3401, framework: 'nextjs' },
    app: { type: 'mobile', path: 'apps/app', port: 3402, framework: 'expo' },
  },`;

	/** A declared database, which is what puts Postgres in the plan. */
	function database() {
		mkdirSync(join(dir, 'constructs'), { recursive: true });
		writeFileSync(
			join(dir, 'constructs', 'database.ts'),
			`import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';

export const database = new KyselyDatabase('Database');
`,
		);
	}

	it('generates secrets on a first run, and has nothing to start', async () => {
		config(apps);

		await setupCommand();

		const secrets = await readStageSecrets('dev', dir);
		expect(secrets?.stage).toBe('dev');
		expect(secrets?.custom.NODE_ENV).toBe('development');
		const said = output(log);
		expect(said).toContain('Generating fresh development secrets');
		expect(said).toContain('No containers declared');
		expect(said).toContain('🔧 api → http://localhost:3400');
		expect(said).toContain('🌐 web → http://localhost:3401');
		expect(said).toContain('📱 app → http://localhost:3402');
		expect(said).toContain('gkm secrets:show --stage dev');
	});

	it('keeps existing secrets, adding only what is missing', async () => {
		config(`${apps}\n  constructs: './constructs/**/*.ts',`);
		database();
		await writeStageSecrets(
			{
				stage: 'dev',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
				services: {},
				urls: {},
				custom: { STRIPE_KEY: 'sk_kept' },
			},
			dir,
		);

		await setupCommand({ skipDocker: true });

		const secrets = await readStageSecrets('dev', dir);
		expect(secrets?.custom.STRIPE_KEY).toBe('sk_kept');
		// The declared database brought Postgres, and with it credentials.
		expect(secrets?.services.postgres).toBeDefined();
		expect(secrets?.services.pgboss?.username).toBe('pgboss');
		expect(output(log)).toContain('Using existing local secrets');
		expect(existsSync(join(dir, 'docker', '.env'))).toBe(true);
		// The per-role passwords the Postgres init script reads.
		expect(readFileSync(join(dir, 'docker', '.env'), 'utf-8')).toContain(
			`PGBOSS_DB_PASSWORD=${secrets?.services.pgboss?.password}`,
		);
	});

	it('uses existing secrets unchanged when nothing is missing', async () => {
		config('');
		await setupCommand({ skipDocker: true });
		const first = await readStageSecrets('dev', dir);

		await setupCommand({ skipDocker: true, stage: 'dev' });

		expect(await readStageSecrets('dev', dir)).toEqual(first);
	});

	it('regenerates everything on --force, and a single app gets its own set', async () => {
		config('');
		await setupCommand({ skipDocker: true });
		const first = await readStageSecrets('dev', dir);

		await setupCommand({ skipDocker: true, force: true });

		const second = await readStageSecrets('dev', dir);
		expect(output(log)).toContain('Generating fresh secrets (--force)');
		expect(second?.custom.JWT_SECRET).toMatch(/^dev-/);
		expect(second?.custom.JWT_SECRET).not.toBe(first?.custom.JWT_SECRET);
	});

	it('exits when there is no config to set up', async () => {
		await expect(setupCommand()).rejects.toThrow(new Exited(1));
		expect(output(error)).toContain('No gkm.config.ts found');
	});

	describe('with secrets shared through SSM', () => {
		// With a constructs glob: a config with neither apps nor constructs is
		// a single-app one, which has no \`state\` block.
		const ssm = `constructs: './src/constructs/**/*.ts',
  state: { provider: 'ssm', region: 'us-east-1' },`;

		beforeEach(() => {
			vi.stubEnv('AWS_ENDPOINT_URL', 'http://localhost:4566');
			vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
			vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
			vi.stubEnv('AWS_REGION', 'us-east-1');
		});

		it('pushes fresh secrets for the team, then a new machine pulls them', async () => {
			// A name nobody else in the emulator has used.
			config(ssm, `shop-${Date.now()}`);

			await setupCommand({ skipDocker: true });
			expect(output(log)).toContain('No remote secrets found');
			expect(output(log)).toContain('Secrets pushed to SSM');
			const pushed = await readStageSecrets('dev', dir);

			// A second machine: no local secrets.
			rmSync(join(dir, '.gkm'), { recursive: true, force: true });
			log.mockClear();
			await setupCommand({ skipDocker: true });

			expect(output(log)).toContain('Pulled secrets from SSM');
			expect(await readStageSecrets('dev', dir)).toEqual(pushed);
		});

		it('does not push when the developer declines', async () => {
			answers.shouldPush = false;
			config(ssm, `shop-declined-${Date.now()}`);

			await setupCommand({ skipDocker: true });

			expect(output(log)).not.toContain('Secrets pushed to SSM');
		});

		it('generates locally when SSM cannot be reached', async () => {
			vi.stubEnv('AWS_ENDPOINT_URL', 'http://127.0.0.1:1');
			config(ssm);

			await setupCommand({ skipDocker: true, yes: true });

			expect(output(warn)).toContain('Failed to pull from SSM');
			expect(await readStageSecrets('dev', dir)).not.toBeNull();
		});
	});
});
