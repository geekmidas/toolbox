/**
 * The Vitest global setup for a gkm project: the test stage, reconciled and
 * migrated, before any test runs.
 *
 * ```ts
 * // vitest.config.ts — the only one
 * export default defineConfig({
 *   test: { globalSetup: ['@geekmidas/cli/vitest'] },
 * });
 * ```
 *
 * Declared once, at the root, it runs however the suite starts — `gkm test`,
 * plain `vitest`, an editor's runner, a filtered run of one project. Its
 * databases are migrated for every construct at once, and kept rather than
 * dropped afterwards, so there is no per-project setup to be skipped by a
 * filter and no teardown to run twice.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_MANIFEST_ENV } from './test/harness';
import { TEST_READY_ENV, TEST_READY_FILE, type TestReady } from './test/ready';

/** This package's `gkm`, whichever install of it loaded this file. */
const GKM = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'bin',
	'gkm.mjs',
);

/**
 * What this setup uses of Vitest's `TestProject` — written out rather than
 * imported, so declaring it does not drag Vite's types into this package's.
 */
export interface RerunningProject {
	onTestsRerun(callback: () => void | Promise<void>): void;
}

export default function setup(project?: RerunningProject): void {
	const cwd = process.cwd();

	// `gkm test` did the work before starting Vitest; anything else — plain
	// `vitest`, an editor — has it done now, the same way.
	const readyPath = process.env[TEST_READY_ENV] ?? prepare(cwd);
	const ready = JSON.parse(readFileSync(readyPath, 'utf-8')) as TestReady;

	// Into this process's environment, which every worker Vitest starts after
	// this inherits — the URLs an app reads, and where the harness is.
	const env = JSON.parse(readFileSync(ready.env, 'utf-8')) as Record<
		string,
		string
	>;
	Object.assign(process.env, env);
	if (ready.manifest) process.env[TEST_MANIFEST_ENV] = ready.manifest;

	// A migration written while watching is applied on the next run, rather
	// than waiting for Vitest to be restarted.
	project?.onTestsRerun(() => {
		gkm(['migrate', '--stage', 'test'], cwd);
	});
}

function prepare(cwd: string): string {
	gkm(['test', '--setup'], cwd);
	return join(cwd, TEST_READY_FILE);
}

/**
 * Run `gkm` as its own process.
 *
 * Not in this one: discovery imports the project's constructs, with its path
 * aliases, through the loader `gkm` registers for itself — which a module
 * Vite loaded into Vitest does not have.
 */
function gkm(args: string[], cwd: string): void {
	execFileSync(process.execPath, [GKM, ...args], { cwd, stdio: 'inherit' });
}
