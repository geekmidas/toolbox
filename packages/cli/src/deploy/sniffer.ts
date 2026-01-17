import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SniffResult } from '@geekmidas/envkit/sniffer';
import type { NormalizedAppConfig } from '../workspace/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
 * Detection strategy (in order):
 * 1. Frontend apps: Returns empty (no server secrets)
 * 2. Apps with `requiredEnv`: Uses explicit list from config
 * 3. Entry apps: Imports entry file in subprocess to capture config.parse() calls
 * 4. Apps with `envParser`: Runs SnifferEnvironmentParser to detect usage
 * 5. Apps with neither: Returns empty
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

	// 1. Frontend apps don't have server-side secrets
	if (app.type === 'frontend') {
		return { appName, requiredEnvVars: [] };
	}

	// 2. Entry-based apps with explicit env list
	if (app.requiredEnv && app.requiredEnv.length > 0) {
		return { appName, requiredEnvVars: [...app.requiredEnv] };
	}

	// 3. Entry apps - import entry file in subprocess to trigger config.parse()
	if (app.entry) {
		const result = await sniffEntryFile(app.entry, app.path, workspacePath);

		if (logWarnings && result.error) {
			console.warn(
				`[sniffer] ${appName}: Entry file threw error during sniffing (env vars still captured): ${result.error.message}`,
			);
		}

		return { appName, requiredEnvVars: result.envVars };
	}

	// 4. Apps with envParser - run sniffer to detect env var usage
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

	// 5. No env detection method available
	return { appName, requiredEnvVars: [] };
}

/**
 * Result from sniffing an entry file.
 */
interface EntrySniffResult {
	envVars: string[];
	error?: Error;
}

/**
 * Sniff an entry file by importing it in a subprocess.
 *
 * Entry apps call `config.parse()` at module load time. To capture which
 * env vars are accessed, we:
 * 1. Spawn a subprocess with a module loader hook
 * 2. The loader intercepts `@geekmidas/envkit` and replaces EnvironmentParser
 *    with SnifferEnvironmentParser
 * 3. Import the entry file (triggers config.parse())
 * 4. Capture and return the accessed env var names
 *
 * This approach provides process isolation - each app is sniffed in its own
 * subprocess, preventing module cache pollution.
 *
 * @param entryPath - Relative path to the entry file (e.g., './src/index.ts')
 * @param appPath - The app's path relative to workspace (e.g., 'apps/auth')
 * @param workspacePath - Absolute path to workspace root
 * @returns EntrySniffResult with env vars and optional error
 */
async function sniffEntryFile(
	entryPath: string,
	appPath: string,
	workspacePath: string,
): Promise<EntrySniffResult> {
	const fullEntryPath = resolve(workspacePath, appPath, entryPath);
	const loaderPath = resolve(__dirname, 'sniffer-loader.ts');
	const workerPath = resolve(__dirname, 'sniffer-worker.ts');

	return new Promise((resolvePromise) => {
		const child = spawn(
			'node',
			['--import', loaderPath, workerPath, fullEntryPath],
			{
				cwd: resolve(workspacePath, appPath),
				stdio: ['ignore', 'pipe', 'pipe'],
				env: {
					...process.env,
					// Ensure tsx is available for TypeScript entry files
					NODE_OPTIONS: '--import tsx',
				},
			},
		);

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (data) => {
			stdout += data.toString();
		});

		child.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		child.on('close', (code) => {
			// Try to parse the JSON output from the worker
			try {
				// Find the last JSON object in stdout (worker may emit other output)
				const jsonMatch = stdout.match(/\{[^{}]*"envVars"[^{}]*\}[^{]*$/);
				if (jsonMatch) {
					const result = JSON.parse(jsonMatch[0]);
					resolvePromise({
						envVars: result.envVars || [],
						error: result.error ? new Error(result.error) : undefined,
					});
					return;
				}
			} catch {
				// JSON parse failed
			}

			// If we couldn't parse the output, return empty with error info
			resolvePromise({
				envVars: [],
				error: new Error(
					`Failed to sniff entry file (exit code ${code}): ${stderr || stdout || 'No output'}`,
				),
			});
		});

		child.on('error', (err) => {
			resolvePromise({
				envVars: [],
				error: err,
			});
		});
	});
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
		console.warn(
			`[sniffer] Failed to import SnifferEnvironmentParser: ${message}`,
		);
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
		const sniffed = await sniffAppEnvironment(
			app,
			appName,
			workspacePath,
			options,
		);
		results.set(appName, sniffed);
	}

	return results;
}

// Export for testing
export { sniffEnvParser as _sniffEnvParser, sniffEntryFile as _sniffEntryFile };
