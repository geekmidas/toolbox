#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

// Register tsx loader hooks BEFORE any .ts imports.
// --import tsx works but register() alone doesn't override
// Node 22's built-in strip-only type handling (which lacks enum support).
// Using --import via NODE_OPTIONS ensures tsx fully handles .ts files.
const nodeOptions = process.env.NODE_OPTIONS || '';
if (
	!nodeOptions.includes('--import tsx') &&
	!nodeOptions.includes('--import=tsx') &&
	!nodeOptions.includes('--import file:') &&
	!nodeOptions.includes('--import=file:')
) {
	// Resolve tsx from the CLI package's own node_modules, not the cwd.
	// This ensures it works when the CLI is run via `pnpm dlx` in a
	// directory that doesn't have tsx installed.
	const { createRequire } = await import('node:module');
	const require = createRequire(import.meta.url);
	const tsxPath = pathToFileURL(require.resolve('tsx')).href;

	const { execFileSync } = await import('node:child_process');
	try {
		execFileSync(process.execPath, process.argv.slice(1), {
			stdio: 'inherit',
			env: {
				...process.env,
				NODE_OPTIONS: `${nodeOptions} --import ${tsxPath}`.trim(),
			},
		});
	} catch (e) {
		process.exit(e.status ?? 1);
	}
	process.exit(0);
}

// tsx is loaded. Resolve each module's path aliases through its own tsconfig
// rather than the one tsx took from the cwd — registered after tsx, so it is
// asked first. See `adjacent-tsconfig.mjs`.
const { registerAdjacentTsconfig } = await import('./adjacent-tsconfig.mjs');
await registerAdjacentTsconfig();

// Run the CLI
await import('../dist/index.mjs');
