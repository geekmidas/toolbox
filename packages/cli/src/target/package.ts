/**
 * A target package, found the way the project would find it.
 *
 * From the workspace root, never from the CLI's own location or the process's
 * working directory: the package is the project's dependency, and a CLI run
 * through `pnpm dlx` — or a host deploying a checkout elsewhere — has neither
 * in common with the project.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface TargetPackageManifest {
	name?: string;
	main?: string;
	module?: string;
	exports?: unknown;
	gkm?: { runtime?: unknown };
}

export interface LocatedPackage {
	/** The package's directory, symlinks resolved. */
	dir: string;
	manifest: TargetPackageManifest;
}

/** A target package the project does not have installed. */
export class TargetPackageNotFound extends Error {
	constructor(
		readonly target: string,
		readonly packageName: string,
		readonly from: string,
	) {
		super(
			`deploy.targets.${target} names the package "${packageName}", which is not installed in ${from}. Add it to the workspace root: pnpm add -D ${packageName}`,
		);
		this.name = 'TargetPackageNotFound';
	}
}

/**
 * `name`'s directory and `package.json`, from the nearest `node_modules` at
 * or above `from` — Node's own lookup, without the exports map getting in
 * the way of reading `package.json`.
 */
export function locatePackage(
	name: string,
	from: string,
): LocatedPackage | undefined {
	let dir = from;
	while (true) {
		const manifestPath = join(dir, 'node_modules', name, 'package.json');
		if (existsSync(manifestPath)) {
			return {
				dir: realpathSync(dirname(manifestPath)),
				manifest: JSON.parse(
					readFileSync(manifestPath, 'utf-8'),
				) as TargetPackageManifest,
			};
		}
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

/** The first file a conditions object leads to, as an `import` would. */
function pick(node: unknown): string | undefined {
	if (typeof node === 'string') return node;
	if (Array.isArray(node)) {
		for (const option of node) {
			const found = pick(option);
			if (found) return found;
		}
		return undefined;
	}
	if (node && typeof node === 'object') {
		const conditions = node as Record<string, unknown>;
		for (const condition of ['import', 'node', 'default', 'require']) {
			if (condition in conditions) {
				const found = pick(conditions[condition]);
				if (found) return found;
			}
		}
	}
	return undefined;
}

/** The file `import(name)` loads, relative to the package directory. */
export function packageEntry(manifest: TargetPackageManifest): string {
	const { exports } = manifest;
	let root: unknown = exports;
	if (exports && typeof exports === 'object' && !Array.isArray(exports)) {
		const keys = Object.keys(exports);
		// A subpath map — `{ ".": …, "./x": … }` — rather than one conditions
		// object for the root.
		if (keys.some((key) => key.startsWith('.'))) {
			root = (exports as Record<string, unknown>)['.'];
		}
	}
	return pick(root) ?? manifest.module ?? manifest.main ?? 'index.js';
}

/** The module `name` is, imported from where the project would import it. */
export async function importPackage(
	target: string,
	name: string,
	from: string,
): Promise<Record<string, unknown>> {
	const located = locatePackage(name, from);
	if (!located) throw new TargetPackageNotFound(target, name, from);

	const entry = join(located.dir, packageEntry(located.manifest));
	return (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
}
