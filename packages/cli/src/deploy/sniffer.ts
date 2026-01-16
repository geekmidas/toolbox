import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SniffResult } from '@geekmidas/envkit/sniffer';
import type { NormalizedAppConfig } from '../workspace/types.js';

// Re-export SniffResult for consumers
export type { SniffResult } from '@geekmidas/envkit/sniffer';

/**
 * Result of sniffing an app's environment requirements.
 */
export interface SniffedEnvironment {
	appName: string;
	requiredEnvVars: string[];
}

/**
 * Options for sniffing an app's environment.
 */
export interface SniffAppOptions {
	/** Whether to log warnings for errors encountered during sniffing. Defaults to true. */
	logWarnings?: boolean;
}

/**
 * Get required environment variables for an app.
 *
 * Detection strategy:
 * - Frontend apps: Returns empty (no server secrets)
 * - Apps with `requiredEnv`: Uses explicit list from config
 * - Apps with `envParser`: Runs SnifferEnvironmentParser to detect usage
 * - Apps with neither: Returns empty
 *
 * This function handles "fire and forget" async operations gracefully,
 * capturing errors and unhandled rejections without failing the build.
 *
 * @param app - The normalized app configuration
 * @param appName - The name of the app
 * @param workspacePath - Absolute path to the workspace root
 * @param options - Optional configuration for sniffing behavior
 * @returns The sniffed environment with required variables
 */
export async function sniffAppEnvironment(
	app: NormalizedAppConfig,
	appName: string,
	workspacePath: string,
	options: SniffAppOptions = {},
): Promise<SniffedEnvironment> {
	const { logWarnings = true } = options;

	// Frontend apps don't have server-side secrets
	if (app.type === 'frontend') {
		return { appName, requiredEnvVars: [] };
	}

	// Entry-based apps with explicit env list
	if (app.requiredEnv && app.requiredEnv.length > 0) {
		return { appName, requiredEnvVars: [...app.requiredEnv] };
	}

	// Apps with envParser - run sniffer to detect env var usage
	if (app.envParser) {
		const result = await sniffEnvParser(app.envParser, app.path, workspacePath);

		// Log any issues for debugging
		if (logWarnings) {
			if (result.error) {
				console.warn(
					`[sniffer] ${appName}: envParser threw error during sniffing (env vars still captured): ${result.error.message}`,
				);
			}
			if (result.unhandledRejections.length > 0) {
				console.warn(
					`[sniffer] ${appName}: Fire-and-forget rejections during sniffing (suppressed): ${result.unhandledRejections.map((e) => e.message).join(', ')}`,
				);
			}
		}

		return { appName, requiredEnvVars: result.envVars };
	}

	// No env detection method available
	return { appName, requiredEnvVars: [] };
}

/**
 * Run the SnifferEnvironmentParser on an envParser module to detect
 * which environment variables it accesses.
 *
 * This function handles "fire and forget" async operations by using
 * the shared sniffWithFireAndForget utility from @geekmidas/envkit.
 *
 * @param envParserPath - The envParser config (e.g., './src/config/env#envParser')
 * @param appPath - The app's path relative to workspace
 * @param workspacePath - Absolute path to workspace root
 * @returns SniffResult with env vars and any errors encountered
 */
async function sniffEnvParser(
	envParserPath: string,
	appPath: string,
	workspacePath: string,
): Promise<SniffResult> {
	// Parse the envParser path: './src/config/env#envParser' or './src/config/env'
	const [modulePath, exportName = 'default'] = envParserPath.split('#');
	if (!modulePath) {
		return { envVars: [], unhandledRejections: [] };
	}

	// Resolve the full path to the module
	const fullPath = resolve(workspacePath, appPath, modulePath);

	// Dynamically import the sniffer utilities
	let SnifferEnvironmentParser: any;
	let sniffWithFireAndForget: any;
	try {
		const envkitModule = await import('@geekmidas/envkit/sniffer');
		SnifferEnvironmentParser = envkitModule.SnifferEnvironmentParser;
		sniffWithFireAndForget = envkitModule.sniffWithFireAndForget;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[sniffer] Failed to import SnifferEnvironmentParser: ${message}`);
		return { envVars: [], unhandledRejections: [] };
	}

	const sniffer = new SnifferEnvironmentParser();

	return sniffWithFireAndForget(sniffer, async () => {
		// Import the envParser module
		const moduleUrl = pathToFileURL(fullPath).href;
		const module = await import(moduleUrl);

		// Get the envParser function
		const envParser = module[exportName];
		if (typeof envParser !== 'function') {
			console.warn(
				`[sniffer] Export "${exportName}" from "${modulePath}" is not a function`,
			);
			return;
		}

		// The envParser function typically creates and configures an EnvironmentParser.
		// We pass our sniffer which implements the same interface.
		const result = envParser(sniffer);

		// If the result is a ConfigParser, call parse() to trigger env var access
		if (result && typeof result.parse === 'function') {
			try {
				result.parse();
			} catch {
				// Parsing may fail due to mock values, that's expected
			}
		}
	});
}

/**
 * Sniff environment requirements for multiple apps.
 *
 * @param apps - Map of app name to app config
 * @param workspacePath - Absolute path to workspace root
 * @param options - Optional configuration for sniffing behavior
 * @returns Map of app name to sniffed environment
 */
export async function sniffAllApps(
	apps: Record<string, NormalizedAppConfig>,
	workspacePath: string,
	options: SniffAppOptions = {},
): Promise<Map<string, SniffedEnvironment>> {
	const results = new Map<string, SniffedEnvironment>();

	for (const [appName, app] of Object.entries(apps)) {
		const sniffed = await sniffAppEnvironment(app, appName, workspacePath, options);
		results.set(appName, sniffed);
	}

	return results;
}

// Export for testing
export { sniffEnvParser as _sniffEnvParser };
