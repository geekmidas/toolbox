/**
 * Resolve a module's path aliases through the tsconfig beside it.
 *
 * tsx applies one tsconfig to the whole process — the one in the directory the
 * command ran from. The workspace's `constructs` glob loads every app's code
 * from wherever a command started, so `~/router.ts` in `apps/api` was being
 * read with `apps/web`'s `~` when the command ran there, and resolved to
 * nothing. TypeScript itself resolves an import through the tsconfig that owns
 * the importing file; this does the same at runtime.
 *
 * Registered after tsx, so it runs first. It only answers a non-relative
 * specifier from TypeScript source outside `node_modules` that the adjacent
 * tsconfig's `paths` actually map — everything else, and anything a mapped
 * candidate fails to resolve to, goes to the next resolver untouched.
 */

import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPathsMatcher, getTsconfig } from 'get-tsconfig';

/** Directory → the paths matcher of the tsconfig that owns it, if any. */
const matchers = new Map();
/** Shared with `get-tsconfig`, so a config `extends` is read once. */
const tsconfigCache = new Map();

const TS_SOURCE = /\.(?:[cm]?ts|tsx)$/;
/** Relative, absolute, or carrying a scheme (`node:`, `file:`, `data:`). */
const NOT_BARE = /^(?:\.{1,2}(?:\/|$)|\/|[a-zA-Z][a-zA-Z\d+.-]*:)/;

function matcherFor(directory) {
	if (!matchers.has(directory)) {
		const tsconfig = getTsconfig(directory, 'tsconfig.json', tsconfigCache);
		matchers.set(directory, tsconfig ? createPathsMatcher(tsconfig) : null);
	}
	return matchers.get(directory);
}

export async function resolve(specifier, context, nextResolve) {
	const parent = context.parentURL;
	if (!parent?.startsWith('file:') || NOT_BARE.test(specifier)) {
		return nextResolve(specifier, context);
	}

	const parentPath = fileURLToPath(parent);
	if (!TS_SOURCE.test(parentPath) || parentPath.includes('/node_modules/')) {
		return nextResolve(specifier, context);
	}

	const match = matcherFor(dirname(parentPath));
	for (const candidate of match?.(specifier) ?? []) {
		try {
			return await nextResolve(pathToFileURL(candidate).href, context);
		} catch {
			// The next mapping, as TypeScript tries them in order.
		}
	}

	return nextResolve(specifier, context);
}
