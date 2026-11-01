import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { bundleServer } from '../bundler';

/**
 * A package with native code loads its binary from beside its own source —
 * argon2's `nodeGypBuild(__dirname)`. Inlined into an ES module bundle,
 * `__dirname` does not exist and the binary is not there. Real esbuild, and a
 * bundle that is started: the package is left out, and resolved where an
 * image installs it.
 */
describe('bundleServer and a package with native code', () => {
	let dir: string;

	async function addon(name: string, files: Record<string, string>) {
		const pkg = join(dir, 'node_modules', name);
		await mkdir(pkg, { recursive: true });
		for (const [file, content] of Object.entries(files)) {
			await writeFile(join(pkg, file), content);
		}
	}

	beforeEach(async () => {
		dir = await createTempDir('gkm-bundle-native-');
		await writeFile(
			join(dir, 'package.json'),
			JSON.stringify({
				name: 'app',
				type: 'module',
				dependencies: { hasher: '1.0.0', unused: '2.0.0', pure: '1.0.0' },
			}),
		);
		// Shaped like argon2: CommonJS, a binding.gyp, and its binary found
		// relative to its own directory.
		await addon('hasher', {
			'package.json': JSON.stringify({
				name: 'hasher',
				version: '1.0.0',
				main: 'index.js',
			}),
			'binding.gyp': '{}',
			'index.js':
				"exports.hash = (s) => require('node:path').basename(__dirname) + ':' + s;",
		});
		await addon('unused', {
			'package.json': JSON.stringify({ name: 'unused', version: '2.0.0' }),
			'binding.gyp': '{}',
			'index.js': 'module.exports = {};',
		});
		await addon('pure', {
			'package.json': JSON.stringify({
				name: 'pure',
				version: '1.0.0',
				type: 'module',
				main: 'index.js',
			}),
			'index.js': "export const greet = (s) => 'hi ' + s;",
		});
		await mkdir(join(dir, '.gkm', 'server'), { recursive: true });
	});
	afterEach(async () => {
		await cleanupDir(dir);
	});

	it('leaves it out of the bundle, and records the version to install beside it', async () => {
		const entryPoint = join(dir, '.gkm', 'server', 'server.ts');
		await writeFile(
			entryPoint,
			`import { hash } from 'hasher';\nimport { greet } from 'pure';\nconsole.log(hash(greet('x')));\nconsole.log(typeof await Promise.resolve(1));\n`,
		);
		const outputDir = join(dir, '.gkm', 'server', 'dist');

		const result = await bundleServer({
			entryPoint,
			outputDir,
			minify: true,
			sourcemap: false,
			external: [],
		});

		expect(
			execFileSync(process.execPath, [join(outputDir, 'server.mjs')], {
				encoding: 'utf-8',
			}),
		).toBe('hasher:hi x\nnumber\n');
		// The one the bundle imports; not one the app depends on and never
		// loads, and not the pure package, which is inlined.
		expect(result.externals).toEqual({ hasher: '1.0.0' });
		expect(
			JSON.parse(
				await readFile(join(outputDir, 'server.externals.json'), 'utf-8'),
			),
		).toEqual({ private: true, dependencies: { hasher: '1.0.0' } });
	});

	it('records nothing for a bundle with no native package', async () => {
		const entryPoint = join(dir, '.gkm', 'server', 'server.ts');
		await writeFile(
			entryPoint,
			`import { greet } from 'pure';\nconsole.log(greet('x'));\n`,
		);
		const outputDir = join(dir, '.gkm', 'server', 'dist');

		await bundleServer({
			entryPoint,
			outputDir,
			minify: false,
			sourcemap: false,
			external: [],
		});

		expect(
			JSON.parse(
				await readFile(join(outputDir, 'server.externals.json'), 'utf-8'),
			),
		).toEqual({ private: true, dependencies: {} });
	});
});
