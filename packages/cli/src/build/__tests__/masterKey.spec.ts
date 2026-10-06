import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { itWithDir } from '@geekmidas/testkit/os';
import { afterEach, describe, expect, vi } from 'vitest';
import {
	createMockEndpointFile,
	createTestFile,
} from '../../__tests__/test-helpers';
import { keyFingerprint } from '../../secrets/encryption';
import { buildCommand, MASTER_KEY_FILE } from '../index';

/** A key as `encryptSecrets` makes one: 32 bytes, hex. */
const MASTER_KEY = 'a1'.repeat(32);

// The bundle is esbuild's job and has its own tests; what this one is about is
// what the build does with the key the bundle was encrypted with.
vi.mock('../bundler', () => ({
	bundleServer: vi.fn(async () => ({
		outputPath: '.gkm/server/dist/server.mjs',
		masterKey: MASTER_KEY,
	})),
}));

describe('gkm build --stage', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	itWithDir(
		'never prints the master key: it names it by fingerprint and leaves it beside the bundle',
		async ({ dir }) => {
			await createMockEndpointFile(
				dir,
				'src/endpoints/health.ts',
				'healthEndpoint',
				'/health',
				'GET',
			);
			await createTestFile(
				dir,
				'gkm.config.ts',
				`
export default {
  stages: { local: 'development', deployed: ['production'] },
  constructs: './src/**/*.ts',
};
`,
			);

			const out: string[] = [];
			for (const level of ['log', 'warn', 'error', 'info'] as const) {
				vi.spyOn(console, level).mockImplementation((...a) => {
					out.push(a.join(' '));
				});
			}

			const originalCwd = process.cwd();
			process.chdir(dir);
			try {
				const result = await buildCommand({
					provider: 'server',
					production: true,
					stage: 'production',
				});

				const said = out.join('\n');
				expect(said).not.toContain(MASTER_KEY);
				expect(said).toContain(keyFingerprint(MASTER_KEY));
				expect(said).toContain(join('.gkm', 'server', MASTER_KEY_FILE));

				const keyPath = join(dir, '.gkm', 'server', MASTER_KEY_FILE);
				expect((await readFile(keyPath, 'utf8')).trim()).toBe(MASTER_KEY);
				expect(statSync(keyPath).mode & 0o777).toBe(0o600);
				// Programmatic callers still get it.
				expect(result).toMatchObject({ masterKey: MASTER_KEY });
			} finally {
				process.chdir(originalCwd);
			}
		},
	);
});
