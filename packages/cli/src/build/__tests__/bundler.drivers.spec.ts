import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { bundleServer } from '../bundler';

/**
 * A @geekmidas package keeps a provider's SDK behind a driver in its own
 * entry — `@geekmidas/constructs/encryption/kms` for `@aws-sdk/client-kms` —
 * which only an entry built for that provider imports. Real esbuild, and a
 * bundle that is started, not only written: a bundle that names a package
 * nothing installed must fail here, never on the server.
 */
describe('bundleServer and a driver behind its own entry', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await createTempDir('gkm-bundle-drivers-');
		await writeFile(
			join(dir, 'package.json'),
			JSON.stringify({
				name: 'app',
				type: 'module',
				dependencies: { '@geekmidas/fake': '1.0.0' },
			}),
		);
		// Shaped like constructs' encryption: the construct opens what a
		// registered driver handles, and the driver's entry imports its SDK.
		const pkg = join(dir, 'node_modules', '@geekmidas', 'fake');
		await mkdir(pkg, { recursive: true });
		await writeFile(
			join(pkg, 'package.json'),
			JSON.stringify({
				name: '@geekmidas/fake',
				type: 'module',
				exports: { '.': './index.js', './kms': './kms.js' },
				peerDependencies: { 'sdk-missing': '*' },
				peerDependenciesMeta: { 'sdk-missing': { optional: true } },
			}),
		);
		await writeFile(
			join(pkg, 'index.js'),
			`const drivers = new Map();
export function register(driver) { drivers.set(driver.scheme, driver); }
export function open(url) {
  const scheme = url.slice(0, url.indexOf(':') + 1);
  if (scheme === 'local:') return 'local';
  const driver = drivers.get(scheme);
  if (!driver) throw new Error('unregistered ' + scheme);
  return driver.open(url);
}`,
		);
		await writeFile(
			join(pkg, 'kms.js'),
			`import { client } from 'sdk-missing';\nexport const kmsDriver = { scheme: 'kms:', open: () => client() };`,
		);
		await mkdir(join(dir, '.gkm', 'server'), { recursive: true });
	});
	afterEach(async () => {
		await cleanupDir(dir);
	});

	async function bundle(entry: string) {
		const entryPoint = join(dir, '.gkm', 'server', 'server.ts');
		await writeFile(entryPoint, entry);
		const outputDir = join(dir, '.gkm', 'server', 'dist');
		await bundleServer({
			entryPoint,
			outputDir,
			minify: false,
			sourcemap: false,
			external: [],
		});
		return join(outputDir, 'server.mjs');
	}

	it('bundles and starts an entry that registers no driver, without the SDK', async () => {
		const server = await bundle(
			`import { open } from '@geekmidas/fake';\nconsole.log(open('local://key'));\n`,
		);

		expect(
			execFileSync(process.execPath, [server], { encoding: 'utf-8' }),
		).toBe('local\n');
	});

	it('fails the build of an entry that registers a driver whose SDK is not installed', async () => {
		await expect(
			bundle(
				`import { open, register } from '@geekmidas/fake';\nimport { kmsDriver } from '@geekmidas/fake/kms';\nregister(kmsDriver);\nconsole.log(open('local://key'));\n`,
			),
		).rejects.toThrow(/Failed to bundle server/);
	});
});
