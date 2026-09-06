import { mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readStageSecrets, secretsExist } from '../../secrets/storage.js';
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
		services: {},
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

		expect(secrets.custom.NODE_ENV).toBe('development');
		expect(secrets.custom.JWT_SECRET).toBeTruthy();
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
  name: 'test-workspace',
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
  services: {},
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
	});

	afterEach(async () => {
		if (originalGkmConfigPath === undefined) {
			delete process.env.GKM_CONFIG_PATH;
		} else {
			process.env.GKM_CONFIG_PATH = originalGkmConfigPath;
		}

		await rm(testDir, { recursive: true, force: true });
		// writeStageSecrets mints a key at ~/.gkm/{basename(root)}
		await rm(join(homedir(), '.gkm', basename(testDir)), {
			recursive: true,
			force: true,
		});
	});

	it('generates a decryptable stage when none exists', async () => {
		expect(secretsExist('development', testDir)).toBe(false);

		const generated = await ensureStageSecrets('development', testDir);

		expect(generated).toBe(true);
		expect(secretsExist('development', testDir)).toBe(true);

		// Round-trips through the keystore the same way `gkm test` reads it.
		//
		// Asserted on a custom secret rather than a Postgres credential: this
		// project declares no constructs, so there is no database and correctly
		// no credential for one. It used to get one from `services: { db: true }`,
		// which is the config-says-so path this no longer has.
		const read = await readStageSecrets('development', testDir);
		expect(read?.custom.NODE_ENV).toBe('development');
		expect(read?.services.postgres).toBeUndefined();
	});

	it('is a no-op when secrets already exist', async () => {
		await ensureStageSecrets('development', testDir);
		const before = await readStageSecrets('development', testDir);

		const generated = await ensureStageSecrets('development', testDir);

		expect(generated).toBe(false);
		const after = await readStageSecrets('development', testDir);
		expect(after).toEqual(before);
	});
});
