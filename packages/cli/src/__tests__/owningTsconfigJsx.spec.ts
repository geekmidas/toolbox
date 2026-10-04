import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withOwningTsconfigJsx } from '../owningTsconfigJsx';
import { cleanupDir, createTempDir } from './test-helpers';

/**
 * A construct's `.tsx` that the app's tsconfig does not include (#123).
 *
 * `gkm dev` runs each app with tsx from the app's directory, and tsx applies
 * that tsconfig only to the files its `include` covers. An email template in
 * the workspace's `constructs/` is outside it, so tsx compiled it with the
 * classic runtime, and the template — which, under the root tsconfig's
 * `"jsx": "react-jsx"`, has no reason to import React — threw
 * `React is not defined` when it rendered. `gkm test` compiles it with the root
 * tsconfig, where it rendered fine.
 *
 * Run as `gkm dev` runs an app — the tsx CLI, in a real Node process, from the
 * app's directory — because the bug was in which tsconfig reaches which file,
 * which no in-process test can see.
 */

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve('tsx/cli');
const TSX = pathToFileURL(require.resolve('tsx')).href;

describe('a construct .tsx outside the app tsconfig', () => {
	let dir: string;

	beforeEach(async () => {
		dir = realpathSync(await createTempDir('owning-tsconfig-jsx-'));

		const write = (path: string, content: string) => {
			mkdirSync(join(dir, path, '..'), { recursive: true });
			writeFileSync(join(dir, path), content);
		};

		write('package.json', JSON.stringify({ type: 'module' }));
		// The workspace's JSX: the automatic runtime, from Hono.
		write(
			'tsconfig.json',
			JSON.stringify({
				compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'hono/jsx' },
			}),
		);
		// A template that imports no runtime, as the automatic runtime allows.
		write(
			'constructs/templates/MagicLink.tsx',
			[
				'export const MagicLink = ({ url }: { url: string }) => (',
				'\t<a href={url}>Sign in</a>',
				');',
				'',
			].join('\n'),
		);

		// The app's own tsconfig: its `include` leaves `constructs/` out, and
		// its JSX goes through a runtime of its own.
		write(
			'apps/auth/tsconfig.json',
			JSON.stringify({
				extends: '../../tsconfig.json',
				compilerOptions: { jsxImportSource: 'app-jsx' },
				include: ['src/**/*.ts', 'src/**/*.tsx'],
			}),
		);
		write(
			'apps/auth/node_modules/app-jsx/package.json',
			JSON.stringify({
				name: 'app-jsx',
				type: 'module',
				exports: { './jsx-runtime': './jsx-runtime.js' },
			}),
		);
		write(
			'apps/auth/node_modules/app-jsx/jsx-runtime.js',
			[
				'export const jsx = (type, props) => `app-jsx:${type}:${props.children}`;',
				'export const jsxs = jsx;',
				"export const Fragment = 'fragment';",
				'',
			].join('\n'),
		);
		write(
			'apps/auth/src/Badge.tsx',
			'export const Badge = () => <b>auth</b>;\n',
		);
		write(
			'apps/auth/src/main.ts',
			[
				"import { MagicLink } from '../../../constructs/templates/MagicLink.tsx';",
				"import { Badge } from './Badge.tsx';",
				"console.log(String(MagicLink({ url: 'https://x' })));",
				'console.log(String(Badge()));',
				'',
			].join('\n'),
		);
	});

	afterEach(async () => {
		await cleanupDir(dir);
	});

	/** Run the app's entry the way `gkm dev` starts an app. */
	function runApp(nodeOptions: string) {
		return spawnSync(process.execPath, [TSX_CLI, 'src/main.ts'], {
			cwd: join(dir, 'apps', 'auth'),
			encoding: 'utf8',
			env: { ...process.env, NODE_OPTIONS: nodeOptions },
		});
	}

	it('renders with the JSX settings of the tsconfig that owns it', () => {
		const run = runApp(withOwningTsconfigJsx(`--import=${TSX}`));

		expect(run.stderr).not.toContain('is not defined');
		expect(run.stdout.trim().split('\n')).toEqual([
			// The workspace's runtime for the workspace's template…
			'<a href="https://x">Sign in</a>',
			// …and the app's own for the app's.
			'app-jsx:b:auth',
		]);
	});

	it('is what makes it render — tsx alone uses the classic runtime', () => {
		const run = runApp(`--import=${TSX}`);

		expect(run.stderr).toContain('React is not defined');
	});
});
