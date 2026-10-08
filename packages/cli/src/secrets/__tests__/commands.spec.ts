import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSecretsStore } from '../file';
import { createStageSecrets } from '../generator';
import {
	SecretNotSet,
	StageSecretsNotFound,
	secretsImportCommand,
	secretsInitCommand,
	secretsRotateCommand,
	secretsSetCommand,
	secretsShowCommand,
	secretsUnsetCommand,
} from '../index';
import { keystoreProject } from '../keystore';
import type { StageSecrets } from '../types';

/** What `process.exit` becomes here, so a refusal can be asserted on. */
class Exited extends Error {
	constructor(readonly code: number | undefined) {
		super(`process.exit(${code})`);
		this.name = 'Exited';
	}
}

describe('secrets commands', () => {
	let dir: string;
	let home: string;
	let cwd: string;
	const originalHome = process.env.HOME;
	let log: ReturnType<typeof vi.spyOn>;
	let error: ReturnType<typeof vi.spyOn>;
	const printed = () => log.mock.calls.flat().join('\n');
	const errors = () => error.mock.calls.flat().join('\n');

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'gkm-secrets-'));
		home = mkdtempSync(join(tmpdir(), 'gkm-secrets-home-'));
		cwd = process.cwd();
		process.chdir(dir);
		// Stage keys live under ~/.gkm; never the real one.
		process.env.HOME = home;
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		error = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Exited(code as number | undefined);
		});
	});

	afterEach(() => {
		process.chdir(cwd);
		process.env.HOME = originalHome;
		vi.restoreAllMocks();
		rmSync(dir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	/** Outside a workspace, every stage is kept in the file. */
	const stored = (stage: string) => new FileSecretsStore(dir).read(stage);
	const store = (secrets: StageSecrets) =>
		new FileSecretsStore(dir).write(secrets.stage, secrets);

	/** A stage with credentials and URLs for every service, stored encrypted. */
	async function seed(stage = 'dev') {
		const secrets = createStageSecrets(stage, ['postgres', 'redis', 'minio']);
		secrets.custom = { STRIPE_KEY: 'sk_test_123' };
		await store(secrets);
		return secrets;
	}

	describe('secrets:init', () => {
		it('writes a stage outside a workspace', async () => {
			await secretsInitCommand({ stage: 'dev' });

			expect(await stored('dev')).toMatchObject({ stage: 'dev' });
			expect(printed()).toContain('Secrets initialized for stage "dev"');
			expect(printed()).toContain('Store: file');
		});

		it('refuses to overwrite a stage without --force', async () => {
			await seed();

			await expect(secretsInitCommand({ stage: 'dev' })).rejects.toThrow(
				Exited,
			);
			expect(errors()).toContain('Use --force to overwrite');
		});

		it('overwrites with --force', async () => {
			await seed();

			await secretsInitCommand({ stage: 'dev', force: true });

			// The fresh stage has none of the seeded custom secrets.
			expect((await stored('dev'))?.custom).toEqual({});
		});

		it('generates per-app secrets in a workspace with several apps', async () => {
			writeFileSync(
				join(dir, 'gkm.config.ts'),
				`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  constructs: './src/constructs/**/*.ts',
  stages: { local: 'dev', deployed: ['prod'] },
  apps: {
    api: { type: 'backend', path: 'apps/api', port: 3000 },
    web: {
      type: 'web',
      path: 'apps/web',
      port: 3001,
      framework: 'nextjs',
      dependencies: ['api'],
    },
  },
});
`,
			);

			await secretsInitCommand({ stage: 'dev' });

			// Keyed by the workspace's identity, `shop`, not by the folder.
			const workspaceStore = new FileSecretsStore(
				dir,
				keystoreProject({ name: 'shop', root: dir }),
			);
			const custom = (await workspaceStore.read('dev'))?.custom ?? {};
			expect(Object.keys(custom).length).toBeGreaterThan(0);
			// No address of anything a construct declares: derived, and a
			// stored one would win over it.
			expect(
				Object.keys(custom).filter((key) =>
					/_(DATABASE_URL|DB_PASSWORD)$|_URL$/.test(key),
				),
			).toEqual([]);
			expect(printed()).toContain('generating per-app secrets');
			expect(printed()).toContain('Custom secrets:');
		});
	});

	describe('secrets:unset', () => {
		it('removes one custom secret and keeps the rest of the stage', async () => {
			const seeded = await seed();
			await secretsSetCommand(
				'AUTH_DATABASE_URL',
				'postgresql://x@localhost/y',
				{
					stage: 'dev',
				},
			);

			await secretsUnsetCommand('AUTH_DATABASE_URL', { stage: 'dev' });

			const after = await stored('dev');
			expect(after?.custom).toEqual({ STRIPE_KEY: 'sk_test_123' });
			expect(after?.services).toEqual(seeded.services);
			expect(printed()).toContain(
				'Secret "AUTH_DATABASE_URL" removed from stage "dev" (file)',
			);
		});

		it('refuses a key the stage does not hold, changing nothing', async () => {
			const seeded = await seed();

			await expect(
				secretsUnsetCommand('NOPE', { stage: 'dev' }),
			).rejects.toBeInstanceOf(SecretNotSet);
			expect((await stored('dev'))?.updatedAt).toBe(seeded.updatedAt);
		});

		it('refuses a stage with no secrets', async () => {
			await expect(
				secretsUnsetCommand('KEY', { stage: 'nowhere' }),
			).rejects.toBeInstanceOf(StageSecretsNotFound);
		});
	});

	describe('secrets:set', () => {
		it('adds a custom secret from the argument', async () => {
			await seed();

			await secretsSetCommand('SENTRY_DSN', 'https://sentry', {
				stage: 'dev',
			});

			expect((await stored('dev'))?.custom.SENTRY_DSN).toBe('https://sentry');
			expect(printed()).toContain('Secret "SENTRY_DSN" set for stage "dev"');
		});

		describe('from a pipe', () => {
			const stdin = process.stdin;
			const pipe = (content: string) =>
				Object.defineProperty(process, 'stdin', {
					value: Object.assign(Readable.from([Buffer.from(content)]), {
						isTTY: false,
					}),
					configurable: true,
				});

			afterEach(() => {
				Object.defineProperty(process, 'stdin', {
					value: stdin,
					configurable: true,
				});
			});

			it('reads the value piped in, trimmed', async () => {
				await seed();
				pipe('whsec_123\n');

				await secretsSetCommand('WEBHOOK_SECRET', undefined, {
					stage: 'dev',
				});

				expect((await stored('dev'))?.custom.WEBHOOK_SECRET).toBe('whsec_123');
			});

			it('refuses an empty pipe', async () => {
				pipe('');

				await expect(
					secretsSetCommand('WEBHOOK_SECRET', undefined, { stage: 'dev' }),
				).rejects.toThrow(Exited);
				expect(errors()).toContain('No value received from stdin');
			});
		});

		it('refuses a stage that has no secrets', async () => {
			await expect(
				secretsSetCommand('KEY', 'value', { stage: 'nowhere' }),
			).rejects.toThrow(Exited);
			expect(errors()).not.toBe('');
		});

		it('asks for a value on a terminal when none is given', async () => {
			const tty = process.stdin.isTTY;
			Object.defineProperty(process.stdin, 'isTTY', {
				value: true,
				configurable: true,
			});
			try {
				await expect(
					secretsSetCommand('KEY', undefined, { stage: 'dev' }),
				).rejects.toThrow(Exited);
				expect(errors()).toContain('No value provided');
			} finally {
				Object.defineProperty(process.stdin, 'isTTY', {
					value: tty,
					configurable: true,
				});
			}
		});
	});

	describe('secrets:show', () => {
		it('masks every credential, URL and custom secret by default', async () => {
			const secrets = await seed();

			await secretsShowCommand({ stage: 'dev' });

			const out = printed();
			expect(out).toContain('postgres:');
			expect(out).toContain('DATABASE_URL:');
			expect(out).toContain('REDIS_URL:');
			expect(out).toContain('STRIPE_KEY:');
			expect(out).not.toContain(secrets.services.postgres!.password);
			expect(out).not.toContain('sk_test_123');
			expect(out).toContain('Use --reveal to show actual values');
		});

		it('shows the values with --reveal', async () => {
			const secrets = await seed();

			await secretsShowCommand({ stage: 'dev', reveal: true });

			const out = printed();
			expect(out).toContain(secrets.services.postgres!.password);
			expect(out).toContain(secrets.urls.DATABASE_URL!);
			expect(out).toContain('sk_test_123');
			expect(out).not.toContain('--reveal');
		});

		it('shows a stage that holds nothing without inventing entries', async () => {
			// What `secrets:init` writes now: no containers, so no credentials
			// and no URLs — reconcile provides those.
			await store(createStageSecrets('bare', []));

			await secretsShowCommand({ stage: 'bare' });

			const out = printed();
			expect(out).toContain('Secrets for stage "bare"');
			expect(out).not.toContain('DATABASE_URL');
			expect(out).not.toContain('Custom Secrets:');
		});

		it('refuses a stage that has no secrets', async () => {
			await expect(secretsShowCommand({ stage: 'nowhere' })).rejects.toThrow(
				Exited,
			);
			expect(errors()).toContain('gkm secrets:init --stage nowhere');
		});
	});

	describe('secrets:rotate', () => {
		it('rotates one service and leaves the others', async () => {
			const before = await seed();

			await secretsRotateCommand({ stage: 'dev', service: 'postgres' });

			const after = (await stored('dev'))!;
			expect(after.services.postgres!.password).not.toBe(
				before.services.postgres!.password,
			);
			expect(after.services.redis!.password).toBe(
				before.services.redis!.password,
			);
		});

		it('rotates every service when none is named', async () => {
			const before = await seed();

			await secretsRotateCommand({ stage: 'dev' });

			const after = (await stored('dev'))!;
			for (const service of ['postgres', 'redis', 'minio'] as const) {
				expect(after.services[service]!.password).not.toBe(
					before.services[service]!.password,
				);
			}
			expect(printed()).toContain('Passwords rotated for all services');
		});

		it('refuses a service the stage does not have', async () => {
			await seed();

			await expect(
				secretsRotateCommand({ stage: 'dev', service: 'localstack' }),
			).rejects.toThrow(Exited);
			expect(errors()).toContain('"localstack" not configured');
		});

		it('refuses a stage that has no secrets', async () => {
			await expect(secretsRotateCommand({ stage: 'nowhere' })).rejects.toThrow(
				Exited,
			);
		});
	});

	describe('secrets:import', () => {
		const file = (content: string) => {
			const path = join(dir, 'import.json');
			writeFileSync(path, content);
			return path;
		};

		it('merges imported keys into the custom secrets', async () => {
			await seed();

			await secretsImportCommand(file('{"SENTRY_DSN":"https://s"}'), {
				stage: 'dev',
			});

			expect((await stored('dev'))?.custom).toEqual({
				STRIPE_KEY: 'sk_test_123',
				SENTRY_DSN: 'https://s',
			});
			expect(printed()).toContain('Total custom secrets: 2');
		});

		it('replaces the custom secrets with merge off', async () => {
			await seed();

			await secretsImportCommand(file('{"ONLY":"this"}'), {
				stage: 'dev',
				merge: false,
			});

			expect((await stored('dev'))?.custom).toEqual({
				ONLY: 'this',
			});
		});

		it('refuses a file that is missing, not JSON, or not flat strings', async () => {
			await seed();

			await expect(
				secretsImportCommand(join(dir, 'missing.json'), { stage: 'dev' }),
			).rejects.toThrow(Exited);
			expect(errors()).toContain('File not found');

			await expect(
				secretsImportCommand(file('{nope'), { stage: 'dev' }),
			).rejects.toThrow(Exited);

			await expect(
				secretsImportCommand(file('{"PORT":5432}'), { stage: 'dev' }),
			).rejects.toThrow(Exited);
			expect(errors()).toContain('Value for "PORT" must be a string');

			await expect(
				secretsImportCommand(file('null'), { stage: 'dev' }),
			).rejects.toThrow(Exited);
			expect(errors()).toContain('JSON must be an object');
		});

		it('refuses a stage that has no secrets', async () => {
			await expect(
				secretsImportCommand(file('{"A":"b"}'), { stage: 'nowhere' }),
			).rejects.toThrow(Exited);
		});
	});
});
