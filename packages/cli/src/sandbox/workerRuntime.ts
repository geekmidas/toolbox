/**
 * What a worker script needs on its side of the sandbox: to answer, to say
 * what would not cross as data, and to resolve the project's path aliases the
 * way `gkm` does.
 *
 * Kept apart from `worker.ts`, which the host runs, so a worker loads nothing
 * of the host's side.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The line prefix a worker's answer is written after, on stdout. */
export const WORKER_RESULT_MARKER = '@@gkm-worker-result@@';

/**
 * Write a worker's answer, and end the worker once it is out.
 *
 * Exiting rather than returning: the project's code may have left a server, a
 * timer or a connection open, and the answer is all the deploy waits for. The
 * callback, because a pipe on macOS is written asynchronously and an exit
 * before it drains would cut the answer short.
 */
export function answer(value: unknown): void {
	process.stdout.write(
		`${WORKER_RESULT_MARKER}${JSON.stringify(value)}\n`,
		() => process.exit(0),
	);
}

/**
 * Where in `value` something is that JSON cannot carry faithfully: a
 * function, a class instance, a symbol, a bigint, a `Date`, a `Map` — as
 * paths like `state.provider` or `apps.api.hooks[0]`.
 *
 * `JSON.stringify` drops a function silently and turns a store into `{}`, so a
 * config that crossed it would arrive *different* rather than refused.
 */
export function liveValuePaths(value: unknown, path = ''): string[] {
	if (value === null) return [];
	switch (typeof value) {
		case 'string':
		case 'boolean':
		case 'undefined':
			return [];
		case 'number':
			return Number.isFinite(value) ? [] : [path || '(root)'];
		case 'object':
			break;
		default:
			return [path || '(root)'];
	}

	if (Array.isArray(value)) {
		return value.flatMap((item, index) =>
			liveValuePaths(item, `${path}[${index}]`),
		);
	}

	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return [path || '(root)'];

	return Object.entries(value as Record<string, unknown>).flatMap(
		([key, item]) => liveValuePaths(item, path ? `${path}.${key}` : key),
	);
}

/** An error, as plain data a host can rebuild a message from. */
export function errorData(error: unknown): {
	name: string;
	message: string;
	[field: string]: unknown;
} {
	if (!(error instanceof Error))
		return { name: 'Error', message: String(error) };
	const fields = Object.fromEntries(
		Object.entries(error).filter(([, v]) => liveValuePaths(v).length === 0),
	);
	return { ...fields, name: error.name, message: error.message };
}

/**
 * Resolve each module's path aliases through its own tsconfig, as `gkm` does
 * — the hook ships beside `bin/gkm.mjs`. Without it a construct importing
 * `~/db` resolves in `gkm dev` and not in a deploy.
 */
export async function registerAdjacentTsconfig(): Promise<void> {
	for (
		let dir = dirname(fileURLToPath(import.meta.url));
		dirname(dir) !== dir;
		dir = dirname(dir)
	) {
		const hook = join(dir, 'bin', 'adjacent-tsconfig.mjs');
		if (existsSync(hook)) {
			const { registerAdjacentTsconfig: register } = await import(
				pathToFileURL(hook).href
			);
			await register();
			return;
		}
	}
}
