import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { itWithDir } from '@geekmidas/testkit/os';
import { describe, expect } from 'vitest';
import { decryptSecrets, encryptSecrets } from '../../secrets/encryption';
import { bundleServer } from '../bundler';

/**
 * The credentials a bundle embeds, through the real esbuild: what the built
 * file holds must decrypt with the key the build handed out. A define quoted
 * twice embeds its quotes, and the IV no longer parses as hex.
 */

/** An entry that prints what the bundle was given. */
async function entry(dir: string): Promise<string> {
	const path = join(dir, '.gkm', 'server', 'server.ts');
	await mkdir(join(dir, '.gkm', 'server'), { recursive: true });
	await writeFile(
		path,
		`declare const __GKM_ENCRYPTED_CREDENTIALS__: string;
declare const __GKM_CREDENTIALS_IV__: string;
console.log(JSON.stringify({ encrypted: __GKM_ENCRYPTED_CREDENTIALS__, iv: __GKM_CREDENTIALS_IV__ }));
`,
	);
	return path;
}

function embedded(output: string): { encrypted: string; iv: string } {
	return JSON.parse(
		execFileSync(process.execPath, [output], { encoding: 'utf-8' }),
	);
}

describe('the credentials a bundle embeds', () => {
	itWithDir(
		'are the ones an image build was given, as they were encrypted',
		async ({ dir }) => {
			const payload = encryptSecrets({ API_KEY: 'sk_live_1' });
			await mkdir(join(dir, '.gkm'), { recursive: true });
			await writeFile(
				join(dir, '.gkm', 'credentials.enc'),
				`${payload.encrypted}\n`,
			);
			await writeFile(join(dir, '.gkm', 'credentials.iv'), `${payload.iv}\n`);

			const { outputPath } = await bundleServer({
				entryPoint: await entry(dir),
				outputDir: join(dir, '.gkm', 'server', 'dist'),
				minify: false,
				sourcemap: false,
				external: [],
			});

			const { encrypted, iv } = embedded(outputPath);
			expect(iv).toBe(payload.iv);
			expect(decryptSecrets(encrypted, iv, payload.masterKey)).toEqual({
				API_KEY: 'sk_live_1',
			});
		},
	);

	itWithDir(
		"are a stage's, decryptable with the key the build returns",
		async ({ dir }) => {
			await mkdir(join(dir, '.gkm', 'secrets'), { recursive: true });
			const now = new Date().toISOString();
			await writeFile(
				join(dir, '.gkm', 'secrets', 'production.json'),
				JSON.stringify({
					stage: 'production',
					createdAt: now,
					updatedAt: now,
					services: {},
					urls: {},
					custom: { API_KEY: 'sk_live_2' },
				}),
			);

			const cwd = process.cwd();
			process.chdir(dir);
			try {
				const { outputPath, masterKey } = await bundleServer({
					entryPoint: await entry(dir),
					outputDir: join(dir, '.gkm', 'server', 'dist'),
					minify: false,
					sourcemap: false,
					external: [],
					stage: 'production',
				});

				const { encrypted, iv } = embedded(outputPath);
				expect(iv).toMatch(/^[0-9a-f]{24}$/);
				expect(decryptSecrets(encrypted, iv, masterKey!)).toMatchObject({
					API_KEY: 'sk_live_2',
				});
			} finally {
				process.chdir(cwd);
			}
		},
	);
});
