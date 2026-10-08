import {
	existsSync,
	mkdirSync,
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
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { loadWorkspaceConfig } from '../../config';
import { FileSecretsStore } from '../../secrets/file';
import { keystoreProject } from '../../secrets/keystore';
import { secretsStoreFor } from '../../secrets/store';

/**
 * `gkm setup` as a developer runs it: in a project, with its keys under a home
 * directory. The keys go to a temporary one, and nothing here starts a
 * container — the projects declare none, or pass `--skip-docker`.
 *
 * The SSM cases talk to the AWS emulator the suite already runs, through the
 * SDK's own `AWS_ENDPOINT_URL`, so reads and writes are the real calls.
 */

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

	const output = (spy: MockInstance) => spy.mock.calls.flat().join('\n');

	beforeEach(async () => {
		dir = realpathSync(await createTempDir('gkm-setup-'));
		cwd = process.cwd();
		process.chdir(dir);
		vi.stubEnv('HOME', dir);
		// Compose reads this from the environment; anything that reaches it from
		// here gets a project of its own, never a shared one.
		vi.stubEnv('COMPOSE_PROJECT_NAME', `gkm-spec-${Date.now()}`);
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		error = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
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

	/** The local stage's file, keyed as the workspace called `name` keys it. */
	const fileStore = (name = 'shop') =>
		new FileSecretsStore(dir, keystoreProject({ name, root: dir }));

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
		config(`${apps}\n  constructs: './constructs/**/*.ts',`);

		await setupCommand();

		const secrets = await fileStore().read('dev');
		expect(secrets?.stage).toBe('dev');
		expect(secrets?.custom.JWT_SECRET).toBeTruthy();
		expect(secrets?.custom).not.toHaveProperty('NODE_ENV');
		const said = output(log);
		expect(said).toContain('Setting up the local environment');
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
		await fileStore().write('dev', {
			stage: 'dev',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			services: {},
			urls: {},
			custom: { STRIPE_KEY: 'sk_kept' },
		});

		await setupCommand({ skipDocker: true });

		const secrets = await fileStore().read('dev');
		expect(secrets?.custom.STRIPE_KEY).toBe('sk_kept');
		// The declared database brought Postgres, and with it credentials.
		expect(secrets?.services.postgres).toBeDefined();
		expect(output(log)).toContain('Using existing secrets');
		// No per-app database URL or password, and no docker/.env: reconcile
		// creates each role from the stage's credential.
		expect(
			Object.keys(secrets?.custom ?? {}).filter((key) =>
				/_(DATABASE_URL|DB_PASSWORD)$/.test(key),
			),
		).toEqual([]);
		expect(existsSync(join(dir, 'docker', '.env'))).toBe(false);
	});

	it('uses existing secrets unchanged when nothing is missing', async () => {
		config(`constructs: './constructs/**/*.ts',`);
		await setupCommand({ skipDocker: true });
		const first = await fileStore().read('dev');

		await setupCommand({ skipDocker: true, stage: 'dev' });

		expect(await fileStore().read('dev')).toEqual(first);
	});

	it('regenerates everything on --force, and a single app gets its own set', async () => {
		config(`constructs: './constructs/**/*.ts',`);
		await setupCommand({ skipDocker: true });
		const first = await fileStore().read('dev');

		await setupCommand({ skipDocker: true, force: true });

		const second = await fileStore().read('dev');
		expect(output(log)).toContain('Generating fresh secrets (--force)');
		expect(second?.custom.JWT_SECRET).toMatch(/^dev-/);
		expect(second?.custom.JWT_SECRET).not.toBe(first?.custom.JWT_SECRET);
	});

	it('exits when there is no config to set up', async () => {
		await expect(setupCommand()).rejects.toThrow(new Exited(1));
		expect(output(error)).toContain('No gkm.config.ts found');
	});

	describe("a deployed stage's providers", () => {
		beforeEach(() => {
			vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
			vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
			vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
			vi.stubEnv('AWS_REGION', 'eu-west-1');
			vi.stubEnv('AWS_PROFILE', undefined);
			vi.stubEnv('GKM_HOME', join(dir, '.gkm-home'));
			mkdirSync(join(dir, 'constructs'), { recursive: true });
			writeFileSync(
				join(dir, 'constructs', 'storage.ts'),
				`import { ObjectStorage } from '@geekmidas/constructs/object-storage';

export const uploads = new ObjectStorage('Uploads');
`,
			);
		});

		it('prints the plan on --dry-run, starting and writing nothing', async () => {
			const name = `dry-${Date.now().toString(36)}`;
			config(
				`constructs: './constructs/**/*.ts',
  deploy: { objects: { prod: { provider: 's3', region: 'eu-west-1' } } },`,
				name,
			);

			await setupCommand({ stage: 'prod', dryRun: true });

			const said = output(log);
			expect(said).toContain("Provisioning the 'prod' stage (dry run)...");
			expect(said).not.toContain('local environment');
			expect(said).toContain(
				"Providers for 'prod' (dry run — nothing is created or written)",
			);
			expect(said).toContain(
				`would create in eu-west-1 — bucket ${name}-prod-uploads`,
			);
			expect(said).toContain(
				`would create under /gkm/ — IAM user gkm-${name}-prod-uploads`,
			);
			expect(said).toMatch(/📋 \d+ changes planned/);
			// No secrets generated, no state, no containers.
			expect(said).not.toContain('Generating fresh');
			expect(existsSync(join(dir, '.gkm', 'secrets', 'prod.json'))).toBe(false);
			expect(existsSync(join(dir, '.gkm', 'deploy-prod.json'))).toBe(false);
		});

		it('says how to name one when the stage has none', async () => {
			config(`constructs: './constructs/**/*.ts',`);

			await setupCommand({ stage: 'prod', dryRun: true });

			expect(output(log)).toContain(
				"None configured: 'prod' takes every key from its secrets",
			);
		});
	});

	describe('with a deployed stage kept in SSM', () => {
		// With a constructs glob: a config with neither apps nor constructs is
		// a single-app one.
		const ssm = `constructs: './src/constructs/**/*.ts',
  secrets: { store: { provider: 'ssm', region: 'us-east-1' } },`;

		/** What the stage's own store holds, resolved as every command does. */
		async function storedIn(stage: string) {
			const { workspace } = await loadWorkspaceConfig(dir);
			return (await secretsStoreFor(workspace, stage)).read(stage);
		}

		beforeEach(() => {
			vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
			vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
			vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
			vi.stubEnv('AWS_REGION', 'us-east-1');
		});

		it('writes fresh secrets to the store, where a new machine finds them', async () => {
			// A name nobody else in the emulator has used.
			config(ssm, `shop-${Date.now()}`);

			await setupCommand({ stage: 'prod', skipDocker: true });
			expect(output(log)).toContain("Provisioning the 'prod' stage...");
			expect(output(log)).not.toContain('local environment');
			expect(output(log)).toContain('Secrets written to the "prod" store');
			// Nothing on this machine to forget to push.
			expect(existsSync(join(dir, '.gkm', 'secrets', 'prod.json'))).toBe(false);
			const stored = await storedIn('prod');
			expect(stored?.stage).toBe('prod');

			// A second machine: the same store, nothing local.
			rmSync(join(dir, '.gkm'), { recursive: true, force: true });
			log.mockClear();
			await setupCommand({ stage: 'prod', skipDocker: true });

			expect(output(log)).toContain('Using existing secrets');
			expect(await storedIn('prod')).toEqual(stored);
		});

		it('keeps the local stage on this machine', async () => {
			const name = `shop-local-${Date.now()}`;
			config(ssm, name);

			await setupCommand({ skipDocker: true });

			expect(output(log)).toContain(
				'Secrets written to the "dev" store (file)',
			);
			expect(output(log)).not.toContain('(ssm)');
			expect(await fileStore(name).read('dev')).not.toBeNull();
		});

		it('stops when SSM cannot be reached, rather than generating secrets nobody can read', async () => {
			vi.stubEnv('AWS_ENDPOINT_URL', 'http://127.0.0.1:1');
			config(ssm);

			await expect(
				setupCommand({ stage: 'prod', skipDocker: true, yes: true }),
			).rejects.toThrow();
			expect(existsSync(join(dir, '.gkm', 'secrets', 'prod.json'))).toBe(false);
		});
	});
});
