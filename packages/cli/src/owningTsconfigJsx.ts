import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REGISTER = 'owning-tsconfig-jsx-register.mjs';

/** The CLI's `bin/` was not found above the module looking for it. */
export class OwningTsconfigJsxHookMissing extends Error {
	constructor(readonly from: string) {
		super(
			`Could not find bin/${REGISTER} in any directory above '${from}'. ` +
				'It ships with @geekmidas/cli beside bin/gkm.mjs; reinstall the ' +
				'package if it is missing.',
		);
		this.name = 'OwningTsconfigJsxHookMissing';
	}
}

/**
 * The CLI's `bin/owning-tsconfig-jsx-register.mjs`, as a file URL. Searched
 * upward because this module runs from `src/` in the repo and from a chunk in
 * `dist/` once built, and `bin/` sits beside both.
 */
function registerUrl(): string {
	const from = dirname(fileURLToPath(import.meta.url));
	for (let dir = from; ; dir = dirname(dir)) {
		const candidate = join(dir, 'bin', REGISTER);
		if (existsSync(candidate)) return pathToFileURL(candidate).href;
		if (dirname(dir) === dir) throw new OwningTsconfigJsxHookMissing(from);
	}
}

/**
 * `NODE_OPTIONS` for a process that runs app code through tsx, with the hook
 * that compiles each `.tsx` with its own tsconfig's JSX settings (see
 * `bin/owning-tsconfig-jsx.mjs`) put in front of every other `--import`, so it
 * is registered before tsx and reads the source on tsx's behalf.
 *
 * `bin/gkm.mjs` already starts the CLI this way, and its children inherit it;
 * this is for those that set `NODE_OPTIONS` themselves, or whose CLI was
 * started with tsx already imported.
 */
export function withOwningTsconfigJsx(nodeOptions = ''): string {
	if (nodeOptions.includes(REGISTER)) return nodeOptions;
	return [`--import=${registerUrl()}`, nodeOptions].filter(Boolean).join(' ');
}
