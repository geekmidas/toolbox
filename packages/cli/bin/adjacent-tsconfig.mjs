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

/**
 * The files a specifier maps to through the importing module's own tsconfig,
 * or nothing when this hook has no business with it.
 */
function candidatesFor(specifier, parent) {
	if (!parent?.startsWith('file:') || NOT_BARE.test(specifier)) return [];

	const parentPath = fileURLToPath(parent);
	if (!TS_SOURCE.test(parentPath) || parentPath.includes('/node_modules/')) {
		return [];
	}

	return matcherFor(dirname(parentPath))?.(specifier) ?? [];
}

/** For `module.register()` — the off-thread hooks. */
export async function resolve(specifier, context, nextResolve) {
	for (const candidate of candidatesFor(specifier, context.parentURL)) {
		try {
			return await nextResolve(pathToFileURL(candidate).href, context);
		} catch {
			// The next mapping, as TypeScript tries them in order.
		}
	}

	return nextResolve(specifier, context);
}

/**
 * For `module.registerHooks()` — the in-thread hooks.
 *
 * tsx 4.23 resolves through these, and they are consulted before anything
 * `register()` installed: its resolver threw on a mapped alias and the
 * off-thread hook above was never asked. Registered the same way, after tsx,
 * this one is asked first again.
 */
export function resolveSync(specifier, context, nextResolve) {
	for (const candidate of candidatesFor(specifier, context.parentURL)) {
		try {
			return nextResolve(pathToFileURL(candidate).href, context);
		} catch {
			// The next mapping, as TypeScript tries them in order.
		}
	}

	return nextResolve(specifier, context);
}

/**
 * Install this hook the way the running tsx installed its own, so it is asked
 * before tsx's resolver rather than after it.
 */
export async function registerAdjacentTsconfig() {
	const { register, registerHooks } = await import('node:module');
	if (registerHooks) {
		registerHooks({ resolve: resolveSync });
	} else {
		register(import.meta.url);
	}
}
