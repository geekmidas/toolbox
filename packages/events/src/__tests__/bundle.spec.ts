import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { rolldown } from 'rolldown';
import { afterEach, describe, expect, it } from 'vitest';

const entry = join(import.meta.dirname, '..', 'index.ts');

/**
 * An app that bundles this package into one file — a Lambda built with esbuild
 * or rolldown — keeps the optional brokers it does not install as externals.
 * Inlining a lazily imported module turns a top-level import inside it into a
 * top-level import of the bundle, so the brokers' client libraries must only
 * ever be imported where they are used.
 */
describe('a single-file bundle with amqplib and pg-boss left out', () => {
	let outDir: string | undefined;

	afterEach(async () => {
		if (outDir) {
			await rm(outDir, { recursive: true, force: true });
		}
	});

	it('loads without either installed', async () => {
		// Outside the repository, so neither external resolves from the bundle.
		outDir = await mkdtemp(join(tmpdir(), 'events-bundle-'));
		const file = join(outDir, 'bundle.mjs');

		const bundle = await rolldown({
			input: entry,
			external: ['amqplib', 'pg-boss'],
			platform: 'node',
			logLevel: 'silent',
		});
		await bundle.write({ file, format: 'esm', inlineDynamicImports: true });
		await bundle.close();

		// A plain node, as a Lambda runs it: the test runner would resolve the
		// externals from the repository instead.
		const { stdout } = await promisify(execFile)(process.execPath, [
			'--input-type=module',
			'--eval',
			`const events = await import(${JSON.stringify(file)}); console.log(typeof events.Publisher);`,
		]);

		expect(stdout.trim()).toBe('function');
	});
});
