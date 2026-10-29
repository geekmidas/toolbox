import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { FileSecretsStore } from '../../secrets/file';
import { keystoreProject } from '../../secrets/keystore';
import { readyStage } from '../index';

describe('readyStage', () => {
	let dir: string;

	beforeEach(async () => {
		// Resolved, because macOS's temp directory is behind a symlink.
		dir = realpathSync(await createTempDir('gkm-ready-'));
		// Stage keys live under the home directory.
		vi.stubEnv('HOME', dir);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		// No database: nothing for reconcile to start.
		writeFileSync(
			join(dir, 'gkm.config.ts'),
			`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  stages: { local: 'dev', deployed: ['prod'] },
  secrets: { enabled: true },
  constructs: './src/constructs/**/*.ts',
  apps: {},
});
`,
		);
		mkdirSync(join(dir, 'src', 'constructs'), { recursive: true });
		writeFileSync(join(dir, 'src', 'constructs', 'noop.ts'), 'export {};\n');

		const keys = keystoreProject({ name: 'shop', root: dir });
		await new FileSecretsStore(dir, keys).write('dev', {
			stage: 'dev',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			services: {},
			urls: {},
			custom: { CLIENT_ID: 'mobile', CLIENT_SECRET: 's3cret' },
		});
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		await cleanupDir(dir);
	});

	// A seed that upserts a client its app authenticates reads the same pair
	// the app does — `gkm secrets:set` puts it nowhere reconcile derives.
	it.each([
		['the local stage', undefined],
		['the test stage', 'test'],
	])("hands %s's seeds the custom secrets its apps get", async (_, stage) => {
		const ready = await readyStage(dir, stage);

		expect(ready.env).toMatchObject({
			CLIENT_ID: 'mobile',
			CLIENT_SECRET: 's3cret',
		});
	});
});
