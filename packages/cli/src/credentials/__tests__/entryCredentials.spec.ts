import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	cleanupDir,
	createSurfaceFile,
	createTempDir,
} from '../../__tests__/test-helpers';
import { writeStageSecrets } from '../../secrets/storage';
import { prepareEntryCredentials } from '../index';

/**
 * What `gkm dev --entry`, `gkm exec` and `gkm test` hand a process, for the two
 * shapes of project they meet: one that declares its constructs, and one with
 * only an older secrets file.
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

	it('defaults the event connection strings for secrets that predate them', async () => {
		// An older secrets file: pg-boss credentials, no event strings.
		await writeStageSecrets(
			{
				stage: 'dev',
				createdAt: '2025-01-01T00:00:00.000Z',
				updatedAt: '2025-01-01T00:00:00.000Z',
				services: {
					postgres: {
						host: 'localhost',
						port: 5432,
						username: 'app',
						password: 'app',
						database: 'shop',
					},
					pgboss: {
						host: 'localhost',
						port: 5432,
						username: 'pgboss',
						password: 'jobs',
						database: 'shop',
					},
				},
				urls: {},
				custom: {},
			},
			dir,
		);

		const result = await prepareEntryCredentials({
			cwd: dir,
			stage: 'dev',
			explicitPort: 4100,
		});

		expect(result.credentials.EVENT_PUBLISHER_CONNECTION_STRING).toBe(
			result.credentials.EVENT_SUBSCRIBER_CONNECTION_STRING,
		);
		expect(result.credentials.EVENT_PUBLISHER_CONNECTION_STRING).toContain(
			'pgboss:jobs@localhost:5432/shop',
		);
		expect(result.credentials.PORT).toBe('4100');
		// And it is written where the preload reads it.
		expect(JSON.parse(readFileSync(result.secretsJsonPath, 'utf-8')).PORT).toBe(
			'4100',
		);
	});
});
