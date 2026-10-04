/**
 * Compile a `.tsx` file's JSX the way the tsconfig that owns it says to.
 *
 * tsx applies one tsconfig to the whole process — the one in the directory the
 * command ran from — and only to the files that tsconfig's `include` covers.
 * `gkm dev` runs each app from its own directory, so a construct's template in
 * the workspace (`constructs/templates/MagicLink.tsx`) was outside the app's
 * `include` and compiled with esbuild's defaults: the classic runtime, which
 * calls `React.createElement` in a file that never imported React, because the
 * root tsconfig's `"jsx": "react-jsx"` said it need not. It threw
 * `React is not defined` at render under `gkm dev` and rendered under
 * `gkm test`, where Vitest compiles each file with its nearest tsconfig.
 *
 * Pointing tsx at the root tsconfig instead would only move the problem: an
 * app may set its own `jsx` or `jsxImportSource` (a Hono app's `hono/jsx`), and
 * one tsconfig per process is the same mistake `adjacent-tsconfig.mjs` exists
 * to undo for path aliases. tsx has no per-file tsconfig, but esbuild — which
 * tsx compiles with — honours JSX pragmas in a file over its options. So this
 * hook, registered before tsx so that it sits between tsx and the file on disk,
 * appends the owning tsconfig's JSX settings to the source as pragmas.
 *
 * The owning tsconfig is the nearest one above the file, as Vitest and
 * `adjacent-tsconfig.mjs` choose it. A file that already carries its own JSX
 * pragma, or whose tsconfig asks for nothing a pragma can say (`preserve`, or
 * no `jsx` at all), is left exactly as it is. The pragma goes at the end, so no
 * line of the file moves and its stack traces still point at the right place.
 *
 * Only ESM sources pass through here: for a CommonJS module tsx reads the file
 * itself, and those keep the process tsconfig's behaviour.
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTsconfig } from 'get-tsconfig';

const JSX_SOURCE = /\.[jt]sx$/;
/** A pragma the file chose for itself, which this hook never overrides. */
const OWN_PRAGMA = /@jsx(?:Runtime|ImportSource|Frag)?\s/;

/** Directory → the pragma its owning tsconfig implies, or `null`. */
const pragmas = new Map();
/** Shared with `get-tsconfig`, so a config `extends` is read once. */
const tsconfigCache = new Map();

/**
 * The pragma comment that tells esbuild what these compiler options tell
 * TypeScript, or `null` when there is nothing to say.
 */
export function jsxPragma(compilerOptions = {}) {
	const jsx = compilerOptions.jsx?.toLowerCase();

	if (jsx === 'react-jsx' || jsx === 'react-jsxdev') {
		const source = compilerOptions.jsxImportSource ?? 'react';
		return `/* @jsxRuntime automatic @jsxImportSource ${source} */`;
	}

	if (jsx === 'react') {
		const parts = ['@jsxRuntime classic'];
		if (compilerOptions.jsxFactory) {
			parts.push(`@jsx ${compilerOptions.jsxFactory}`);
		}
		if (compilerOptions.jsxFragmentFactory) {
			parts.push(`@jsxFrag ${compilerOptions.jsxFragmentFactory}`);
		}
		return `/* ${parts.join(' ')} */`;
	}

	// `preserve` and `react-native` leave JSX in the output, which no pragma
	// can ask for; without `jsx` TypeScript compiles no `.tsx` at all.
	return null;
}

function pragmaFor(directory) {
	if (!pragmas.has(directory)) {
		const tsconfig = getTsconfig(directory, 'tsconfig.json', tsconfigCache);
		pragmas.set(directory, jsxPragma(tsconfig?.config.compilerOptions));
	}
	return pragmas.get(directory);
}

/** The JSX file at this URL, when it is one of the project's own. */
function jsxFilePath(url) {
	if (!url.startsWith('file:')) return null;

	const path = fileURLToPath(url.split(/[?#]/)[0]);
	if (!JSX_SOURCE.test(path) || path.includes('/node_modules/')) return null;

	return path;
}

/** For `module.register()`, so it runs behind tsx however tsx registered. */
export async function load(url, context, nextLoad) {
	const loaded = await nextLoad(url, context);

	const path = jsxFilePath(url);
	if (!path || loaded.source == null) return loaded;

	const pragma = pragmaFor(dirname(path));
	if (!pragma) return loaded;

	const source =
		typeof loaded.source === 'string'
			? loaded.source
			: new TextDecoder().decode(loaded.source);
	if (OWN_PRAGMA.test(source)) return loaded;

	return { ...loaded, source: `${source}\n${pragma}\n` };
}
