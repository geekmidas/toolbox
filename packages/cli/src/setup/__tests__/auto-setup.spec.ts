import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSecretsStore } from '../../secrets/file.js';
import { keystoreProject } from '../../secrets/keystore.js';
import type { NormalizedWorkspace } from '../../workspace/types.js';
import { createFreshWorkspaceSecrets, ensureStageSecrets } from '../index.js';

function createWorkspace(
	overrides: Partial<NormalizedWorkspace> = {},
): NormalizedWorkspace {
	return {
		name: 'test-project',
		root: '/tmp/test-project',
		apps: {
			api: {
				type: 'backend',
				port: 3000,
				root: '/tmp/test-project/apps/api',
				packageName: '@test/api',
				routes: './src/endpoints/**/*.ts',
				dependencies: [],
			},
		},
		deploy: {},
		shared: {},
		secrets: {},
		...overrides,
	} as NormalizedWorkspace;
}

/** What the manifest derived, which is what decides a credential is needed. */
const POSTGRES = ['postgres'] as const;

describe('createFreshWorkspaceSecrets', () => {
	it('generates postgres credentials for a declared database', () => {
		// The container list, not a `db: true` in config: a credential is
		// generated because something declared a database, and a project that
		// declares none gets none rather than an unused password.
		const secrets = createFreshWorkspaceSecrets(
			'development',
			createWorkspace(),
			POSTGRES,
		);

		expect(secrets.stage).toBe('development');
		expect(secrets.services.postgres).toBeDefined();
		expect(secrets.services.postgres?.password).toBeTruthy();
		expect(secrets.urls.DATABASE_URL).toContain('postgresql://');
	});

	it('generates a randomized password each call', () => {
		const a = createFreshWorkspaceSecrets(
			'development',
			createWorkspace(),
			POSTGRES,
		);
		const b = createFreshWorkspaceSecrets(
			'development',
			createWorkspace(),
			POSTGRES,
		);

		expect(a.services.postgres?.password).not.toBe(
			b.services.postgres?.password,
		);
	});

	it('generates nothing for a project that declares nothing', () => {
		// The other half of the same rule, and the one that used to be wrong in
		// the opposite direction: no flag, no credential, whatever config says.
		const secrets = createFreshWorkspaceSecrets(
			'development',
			createWorkspace(),
		);

		expect(secrets.services.postgres).toBeUndefined();
	});

	it('adds single-app custom secrets', () => {
		const secrets = createFreshWorkspaceSecrets(
			'development',
			createWorkspace(),
			POSTGRES,
		);

		expect(secrets.custom.JWT_SECRET).toBeTruthy();
		// The command decides NODE_ENV; a stored one would be injected over it
		// and turn `gkm exec -- next build` into a development build.
		expect(secrets.custom).not.toHaveProperty('NODE_ENV');
	});
});

describe('ensureStageSecrets', () => {
	let testDir: string;
	const originalGkmConfigPath = process.env.GKM_CONFIG_PATH;

	beforeEach(() => {
		testDir = join(
			tmpdir(),
			`gkm-auto-setup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(testDir, { recursive: true });

		// Minimal single-app workspace config with a db service.
		writeFileSync(
			join(testDir, 'gkm.config.ts'),
			`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  stages: { local: 'development', deployed: ['production'] },
  name: 'test-workspace',
  constructs: './src/constructs/**/*.ts',
  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3001,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
    },
  },
});
`,
		);
		const apiDir = join(testDir, 'apps', 'api');
		mkdirSync(apiDir, { recursive: true });
		writeFileSync(
			join(apiDir, 'package.json'),
			JSON.stringify({ name: '@test/api', version: '0.0.1' }),
		);

		process.env.GKM_CONFIG_PATH = join(testDir, 'gkm.config.ts');
		// Stage keys land in the CLI's home; never the real one.
		vi.stubEnv('GKM_HOME', join(testDir, '.gkm-home'));
	});

	afterEach(async () => {
		if (originalGkmConfigPath === undefined) {
			delete process.env.GKM_CONFIG_PATH;
		} else {
			process.env.GKM_CONFIG_PATH = originalGkmConfigPath;
		}

		vi.unstubAllEnvs();
		await rm(testDir, { recursive: true, force: true });
	});

	/** The stage file, keyed as the workspace's identity keys it. */
	const secretsOf = (root: string) =>
		new FileSecretsStore(
			root,
			keystoreProject({ name: 'test-workspace', root }),
		);

	it('generates a decryptable stage when none exists', async () => {
		expect(existsSync(new FileSecretsStore(testDir).path('development'))).toBe(
			false,
		);

		const generated = await ensureStageSecrets('development', testDir);

		expect(generated).toBe(true);
		expect(existsSync(new FileSecretsStore(testDir).path('development'))).toBe(
			true,
		);

		// Round-trips through the keystore the same way `gkm test` reads it.
		//
		// Asserted on a custom secret rather than a Postgres credential: this
		// project's constructs glob matches nothing, so there is no database and
		// correctly no credential for one. It used to get one from `services: { db: true }`,
		// which is the config-says-so path this no longer has.
		const read = await secretsOf(testDir).read('development');
		expect(read?.custom.LOG_LEVEL).toBe('debug');
		expect(read?.services.postgres).toBeUndefined();
	});

	it('is a no-op when secrets already exist', async () => {
		await ensureStageSecrets('development', testDir);
		const before = await secretsOf(testDir).read('development');

		const generated = await ensureStageSecrets('development', testDir);

		expect(generated).toBe(false);
		const after = await secretsOf(testDir).read('development');
		expect(after).toEqual(before);
	});
});
