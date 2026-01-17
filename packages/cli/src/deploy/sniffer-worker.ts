/**
 * Subprocess worker for entry app sniffing.
 *
 * This script is executed in a subprocess with the sniffer-loader.ts
 * registered, which intercepts @geekmidas/envkit imports.
 *
 * Usage:
 *   node --import tsx --import ./sniffer-loader.ts ./sniffer-worker.ts /path/to/entry.ts
 *
 * Output (JSON to stdout):
 *   { "envVars": ["PORT", "DATABASE_URL", ...], "error": null }
 */

import { pathToFileURL } from 'node:url';
import type { SnifferEnvironmentParser } from '@geekmidas/envkit/sniffer';

// Extend globalThis type for the sniffer instance
declare global {
	// eslint-disable-next-line no-var
	var __envSniffer: SnifferEnvironmentParser | undefined;
}

// Get the entry file path from command line args
const entryPath = process.argv[2] as string | undefined;

if (!entryPath) {
	console.log(
		JSON.stringify({ envVars: [], error: 'No entry file path provided' }),
	);
	process.exit(1);
}

// entryPath is guaranteed to be defined after the check above
const validEntryPath: string = entryPath;

/**
 * Main sniffing function
 */
async function sniff(): Promise<void> {
	let error: string | null = null;

	try {
		// Import the entry file - this triggers:
		// 1. Entry imports config module
		// 2. Config module imports @geekmidas/envkit (intercepted by loader)
		// 3. Config creates EnvironmentParser (actually SnifferEnvironmentParser)
		// 4. Config calls .create() and .parse()
		// 5. Sniffer captures all accessed env var names
		const entryUrl = pathToFileURL(validEntryPath).href;
		await import(entryUrl);
	} catch (e) {
		// Entry may fail due to missing env vars or other runtime issues.
		// This is expected - we still capture the env vars that were accessed.
		error = e instanceof Error ? e.message : String(e);
	}

	// Retrieve captured env vars from the global sniffer
	const sniffer = globalThis.__envSniffer;
	const envVars = sniffer ? sniffer.getEnvironmentVariables() : [];

	// Output result as JSON
	console.log(JSON.stringify({ envVars, error }));
}

// Handle unhandled rejections (fire-and-forget promises)
process.on('unhandledRejection', () => {
	// Silently ignore - we only care about env var capture
});

// Run the sniffer
sniff().catch((e) => {
	console.log(JSON.stringify({ envVars: [], error: e.message || String(e) }));
	process.exit(1);
});
