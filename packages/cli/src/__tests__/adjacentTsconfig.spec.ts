import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from './test-helpers';

/**
 * A construct imported from an app whose tsconfig does not map its aliases.
 *
 * The workspace's constructs glob loads every app's code from wherever a
 * command runs — `gkm exec` in `apps/web` discovers `apps/api`'s crons, which
 * import `@shop/constructs/…` through the root tsconfig. tsx reads only the
 * tsconfig in the working directory, so without the hook that alias resolves
 * to nothing, and every frontend's `gkm exec -- vite` died before Vite started.
 *
 * Run in a real Node process with the real tsx, because the failure was in
 * how the two hook chains are ordered, which no in-process test can see.
 */

const HOOK = pathToFileURL(
	join(import.meta.dirname, '..', '..', 'bin', 'adjacent-tsconfig.mjs'),
).href;

describe('the adjacent-tsconfig hook', () => {
	let dir: string;

	beforeEach(async () => {
		dir = realpathSync(await createTempDir('adjacent-tsconfig-'));

		const write = (path: string, content: string) => {
			mkdirSync(join(dir, path, '..'), { recursive: true });
			writeFileSync(join(dir, path), content);
		};

		write('package.json', JSON.stringify({ type: 'module' }));
		write(
			'tsconfig.json',
			JSON.stringify({
				compilerOptions: {
					paths: { '@shop/constructs/*': ['./constructs/*'] },
				},
			}),
		);
		write('constructs/thing.ts', "export const thing: string = 'found';\n");
		write(
			'apps/api/uses.ts',
			"export { thing } from '@shop/constructs/thing.js';\n",
		);
		// The frontend's own tsconfig, which knows nothing about the alias.
		write(
			'apps/web/tsconfig.json',
			JSON.stringify({ compilerOptions: { paths: { '~/*': ['./src/*'] } } }),
		);
	});

	afterEach(async () => {
		await cleanupDir(dir);
	});

	/** Import `apps/api/uses.ts` from `apps/web`, with or without the hook. */
	function importFromWeb(withHook: boolean) {
		const probe = [
			withHook
				? `const { registerAdjacentTsconfig } = await import(${JSON.stringify(HOOK)});
await registerAdjacentTsconfig();`
				: '',
			`const { thing } = await import(${JSON.stringify(join(dir, 'apps/api/uses.ts'))});`,
			'console.log(thing);',
		].join('\n');

		return spawnSync(
			process.execPath,
			['--import', 'tsx', '--input-type=module', '-e', probe],
			{ cwd: join(dir, 'apps', 'web'), encoding: 'utf8' },
		);
	}

	it('resolves an alias through the tsconfig that owns the importing file', () => {
		const run = importFromWeb(true);

		expect(run.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
		expect(run.stdout.trim()).toBe('found');
	});

	it('is what makes it resolve — tsx alone does not', () => {
		const run = importFromWeb(false);

		expect(run.stderr).toContain("Cannot find package '@shop/constructs'");
	});
});
