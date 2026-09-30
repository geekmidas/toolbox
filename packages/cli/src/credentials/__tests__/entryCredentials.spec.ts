import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	cleanupDir,
	createSurfaceFile,
	createTempDir,
} from '../../__tests__/test-helpers';
import { prepareEntryCredentials } from '../index';

/**
 * What `gkm dev --entry`, `gkm exec` and `gkm test` hand a process in a
 * workspace that declares its constructs.
 */
describe('prepareEntryCredentials', () => {
	let dir: string;

	beforeEach(async () => {
		dir = realpathSync(await createTempDir('gkm-entry-creds-'));
		vi.stubEnv('HOME', dir);
		// Compose reads this from the environment; anything that reaches it from
		// here gets a project of its own, never a shared one.
		vi.stubEnv('COMPOSE_PROJECT_NAME', `gkm-spec-${Date.now()}`);
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		await cleanupDir(dir);
	});

	it('hands an app the URLs its workspace’s constructs publish', async () => {
		writeFileSync(
			join(dir, 'gkm.config.ts'),
			`export default {
  name: 'shop',
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './src/constructs/**/*.ts',
  apps: { api: { type: 'backend', path: 'apps/api', port: 3500 } },
};
`,
		);
		await createSurfaceFile(dir);
		// Run from inside the app, as \`gkm exec\` is.
		const app = join(dir, 'apps', 'api');
		mkdirSync(app, { recursive: true });
		writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'api' }));

		// Nothing is started: the addresses are derived, not probed.
		const result = await prepareEntryCredentials({ cwd: app });

		expect(result.appName).toBe('api');
		expect(result.declaredKeys).toContain('TEST_URL');
		expect(result.credentials.TEST_URL).toMatch(/^https?:\/\//);
		// The workspace's port for the app, and its dependency URLs.
		expect(result.credentials.PORT).toBe('3500');
	});
});
