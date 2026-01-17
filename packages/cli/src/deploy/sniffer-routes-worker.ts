/**
 * Subprocess worker for route-based app sniffing.
 *
 * This script is executed in a subprocess with tsx loader,
 * which handles TypeScript compilation and path alias resolution.
 *
 * Usage:
 *   node --import tsx ./sniffer-routes-worker.ts "/path/to/app" "./src/endpoints/**\/*.ts"
 *
 * Output (JSON to stdout):
 *   { "envVars": ["PORT", "DATABASE_URL", ...], "error": null }
 */

import type { Construct } from '@geekmidas/constructs';
import { Cron } from '@geekmidas/constructs/crons';
import { Endpoint } from '@geekmidas/constructs/endpoints';
import { Function as GkmFunction } from '@geekmidas/constructs/functions';
import { Subscriber } from '@geekmidas/constructs/subscribers';
import fg from 'fast-glob';

// Get args from command line
const appPathArg = process.argv[2];
const routesPatternArg = process.argv[3];

if (!appPathArg || !routesPatternArg) {
	console.log(
		JSON.stringify({
			envVars: [],
			error: 'App path and routes pattern are required',
		}),
	);
	process.exit(1);
}

// After validation, these are guaranteed to be strings
const appPath: string = appPathArg;
const routesPattern: string = routesPatternArg;

/**
 * Check if a value is a gkm construct.
 */
function isConstruct(value: unknown): value is Construct {
	return (
		Endpoint.isEndpoint(value) ||
		GkmFunction.isFunction(value) ||
		Cron.isCron(value) ||
		Subscriber.isSubscriber(value)
	);
}

/**
 * Main sniffing function
 */
async function sniff(): Promise<void> {
	const envVars = new Set<string>();
	let error: string | null = null;

	try {
		// Find all route files matching the pattern
		const files = await fg(routesPattern, {
			cwd: appPath,
			absolute: true,
		});

		// Import each route file and find constructs
		for (const file of files) {
			try {
				const module = await import(file);

				// Check all exports for constructs
				for (const [, exportValue] of Object.entries(module)) {
					if (isConstruct(exportValue)) {
						try {
							const constructEnvVars = await exportValue.getEnvironment();
							constructEnvVars.forEach((v) => envVars.add(v));
						} catch {
							// Individual construct may fail, continue with others
						}
					}
				}
			} catch (e) {
				// Log import errors but continue with other files
				const msg = e instanceof Error ? e.message : String(e);
				console.error(`[sniffer] Failed to import ${file}: ${msg}`);
			}
		}
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
	}

	// Output result as JSON (last line of stdout)
	console.log(JSON.stringify({ envVars: Array.from(envVars).sort(), error }));
}

// Handle unhandled rejections
process.on('unhandledRejection', () => {
	// Silently ignore - we only care about env var capture
});

// Run the sniffer
sniff().catch((e) => {
	console.log(JSON.stringify({ envVars: [], error: e.message || String(e) }));
	process.exit(1);
});
