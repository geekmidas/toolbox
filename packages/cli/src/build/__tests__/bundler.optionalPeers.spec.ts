import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { bundleServer, missingOptionalPeers } from '../bundler';

/**
 * A @geekmidas package loads an optional peer only on the path that needs it
 * (`@aws-sdk/client-kms` for a `kms:` key). An app that never takes that path
 * does not install it, and its production bundle — real esbuild, here — must
 * still build.
 */
describe('bundleServer and optional peers', () => {
	let dir: string;

	/** A package in the app's node_modules. */
	async function pkg(name: string, json: object, index = '') {
		const at = join(dir, 'node_modules', name);
		await mkdir(at, { recursive: true });
		await writeFile(
			join(at, 'package.json'),
			JSON.stringify({ name, type: 'module', main: 'index.js', ...json }),
		);
		await writeFile(join(at, 'index.js'), index);
	}

	beforeEach(async () => {
		dir = await createTempDir('gkm-optional-peers-');
		await writeFile(
			join(dir, 'package.json'),
			JSON.stringify({
				name: 'app',
				dependencies: { '@geekmidas/fake': '1.0.0' },
			}),
		);
		// Loads `sdk-missing` only when asked to; `sdk-present` is installed.
		await pkg(
			'@geekmidas/fake',
			{
				dependencies: { '@geekmidas/inner': '1.0.0' },
				peerDependencies: { 'sdk-missing': '*', 'sdk-present': '*' },
				peerDependenciesMeta: {
					'sdk-missing': { optional: true },
					'sdk-present': { optional: true },
				},
			},
			`export async function open(kms) {
  if (kms) return (await import('sdk-missing')).client();
  return 'local';
}
export { inner } from '@geekmidas/inner';`,
		);
		await pkg(
			'@geekmidas/inner',
			{
				peerDependencies: { 'inner-missing': '*' },
				peerDependenciesMeta: { 'inner-missing': { optional: true } },
			},
			'export const inner = 1;',
		);
		await pkg('sdk-present', {}, 'export const client = () => 1;');
	});
	afterEach(async () => {
		await cleanupDir(dir);
	});

	it('names the optional peers nothing installed, through nested @geekmidas packages', () => {
		expect(missingOptionalPeers(join(dir, '.gkm', 'server'))).toEqual([
			'inner-missing',
			'sdk-missing',
		]);
	});

	it('bundles an app that never installed a peer it never loads', async () => {
		const outputDir = join(dir, '.gkm', 'server', 'dist');
		await mkdir(join(dir, '.gkm', 'server'), { recursive: true });
		const entryPoint = join(dir, '.gkm', 'server', 'server.ts');
		await writeFile(
			entryPoint,
			`import { open } from '@geekmidas/fake';\nconsole.log(await open(false));\n`,
		);

		await bundleServer({
			entryPoint,
			outputDir,
			minify: false,
			sourcemap: false,
			external: [],
		});

		const bundle = join(outputDir, 'server.mjs');
		expect(existsSync(bundle)).toBe(true);
		// Left for the path that needs it, not inlined or dropped.
		expect(readFileSync(bundle, 'utf-8')).toContain('sdk-missing');
	});
});
