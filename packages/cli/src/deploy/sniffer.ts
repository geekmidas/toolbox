import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SniffResult } from '@geekmidas/envkit/sniffer';
import { output } from '../output.js';
import { LocalSandbox } from '../sandbox/local.js';
import { activeSandbox, type Sandbox } from '../sandbox/sandbox.js';
import { nodeWithTsx } from '../sandbox/worker.js';
import { normalizeRoutes } from '../workspace/client-generator.js';
import { getPublicEnvPrefix } from '../workspace/publicEnv.js';
import type { NormalizedAppConfig } from '../workspace/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * How long one sniff may run. Importing an entry, a config or a module of
 * routes takes a second or two; one that is still going after this is
 * waiting on something — a server it started, a connection, a prompt — and
 * would otherwise hold the deploy, and its lock, until someone noticed.
 */
export const SNIFF_TIMEOUT_MS = 30_000;

/**
 * Resolve the path to a sniffer helper file.
 * Handles both dev (.ts with tsx) and production (.mjs from dist).
 *
 * In production: sniffer.ts is bundled into dist/index.mjs, but sniffer helper
 * files are output to dist/deploy/ as standalone modules for subprocess loading.
 *
 * In development: All files are in src/deploy/ and loaded via tsx.
 */
function resolveSnifferFile(baseName: string): string {
	// Try deploy/ subdirectory first (production: bundled code is at dist/index.mjs,
	// but sniffer files are at dist/deploy/)
	const deployMjsPath = resolve(__dirname, 'deploy', `${baseName}.mjs`);
	if (existsSync(deployMjsPath)) {
		return deployMjsPath;
	}

	// Try same directory .mjs (production: if running from dist/deploy/ directly)
	const mjsPath = resolve(__dirname, `${baseName}.mjs`);
	if (existsSync(mjsPath)) {
		return mjsPath;
	}

	// Try same directory .ts (development with tsx: all files in src/deploy/)
	const tsPath = resolve(__dirname, `${baseName}.ts`);
	if (existsSync(tsPath)) {
		return tsPath;
	}

	// Fallback to .ts (will error if neither exists)
	return tsPath;
}

// Re-export SniffResult for consumers
export type { SniffResult } from '@geekmidas/envkit/sniffer';

/**
 * Result of sniffing an app's environment requirements.
 */
export interface SniffedEnvironment {
	appName: string;
	/**
	 * All required environment variable names.
	 * When `SniffAppOptions.markOptional` is true, optional variables are
	 * suffixed with `?` (e.g. `PORT?`).
	 */
	requiredEnvVars: string[];
	/**
	 * Subset of variables that are optional (accessed via `.optional()` or
	 * `.default()`). Always populated regardless of `markOptional`.
	 */
	optionalEnvVars: string[];
}

/**
 * Options for sniffing an app's environment.
 */
export interface SniffAppOptions {
	/** Whether to log warnings for errors encountered during sniffing. Defaults to true. */
	logWarnings?: boolean;
	/**
	 * When true, optional variables (those with `.optional()` or `.default()`)
	 * are suffixed with `?` in `requiredEnvVars` (e.g. `PORT?`).
	 * Defaults to false.
	 */
	markOptional?: boolean;
	/**
	 * Where the app's code runs while it is sniffed. Defaults to the run's
	 * own (`withSandbox`), else a {@link LocalSandbox} on the workspace —
	 * either way never this process, and never with its environment.
	 */
	sandbox?: Sandbox;
	/** How long each sniff may run. Defaults to {@link SNIFF_TIMEOUT_MS}. */
	timeoutMs?: number;
}

/** Where a sniff runs, and for how long. */
interface SniffRun {
	sandbox?: Sandbox;
	timeoutMs?: number;
}

/**
 * Run a sniffer worker in the sandbox, with the sandbox's environment and
 * nothing of the deploy's: the deploy's Dokploy token, registry login and AWS
 * keys stay where they are. A worker that outlives the timeout is killed, and
 * comes back as the error the caller reports.
 */
async function runSniffer(
	run: SniffRun,
	workspacePath: string,
	cwd: string,
	nodeArgs: string[],
): Promise<
	{ stdout: string; stderr: string; code: number | null } | { error: Error }
> {
	const sandbox =
		run.sandbox ??
		activeSandbox() ??
		new LocalSandbox({ root: resolve(workspacePath) });

	try {
		const result = await sandbox.exec('node', nodeArgs, {
			cwd,
			env: { ...sandbox.env },
			timeoutMs: run.timeoutMs ?? SNIFF_TIMEOUT_MS,
			output: 'capture',
		});
		return {
			stdout: result.stdout,
			stderr: result.stderr,
			code: result.exitCode,
		};
	} catch (error) {
		return {
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}
}

/** The worker's JSON answer: the last object on stdout naming `envVars`. */
function snifferAnswer(stdout: string):
	| {
			envVars?: string[];
			optionalEnvVars?: string[];
			unhandledRejections?: string[];
			warnings?: string[];
			error?: string | null;
	  }
	| undefined {
	try {
		const jsonMatch = stdout.match(/\{[^{}]*"envVars"[^{}]*\}[^{]*$/);
		return jsonMatch ? JSON.parse(jsonMatch[0]) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Get required environment variables for an app.
 *
 * Detection strategy (in order):
 * 1. Frontend apps: Returns empty (no server secrets)
 * 2. Apps with `requiredEnv`: Uses explicit list from config
 * 3. Entry apps: Imports entry file in subprocess to capture config.parse() calls
 * 4. Route-based apps: Loads route files and calls getEnvironment() on each construct
 * 5. Apps with `envParser` (no routes): Runs SnifferEnvironmentParser to detect usage
 * 6. Apps with neither: Returns empty
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
	const { logWarnings = true, markOptional = false } = options;
	const run: SniffRun = {
		...(options.sandbox ? { sandbox: options.sandbox } : {}),
		...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
	};

	// 1. Frontend apps - handle dependencies and config sniffing
	if (app.type === 'web' || app.type === 'mobile') {
		// Auto-generate {prefix}{DEP}_URL from dependencies, where prefix matches
		// the framework's public-var convention (NEXT_PUBLIC_, VITE_, ...).
		// For frameworks without a prefix (e.g. Remix), no dep var is required.
		const publicPrefix = getPublicEnvPrefix(app.framework);
		const depVars = publicPrefix
			? (app.dependencies ?? []).map(
					(dep) => `${publicPrefix}${dep.toUpperCase()}_URL`,
				)
			: [];

		// If config specified, sniff by importing the file(s)
		// The file calls .parse() at module load, which triggers sniffer to capture vars
		if (app.config) {
			const sniffedVars: string[] = [];
			const sniffedOptional: string[] = [];

			// Collect config paths to sniff
			const configPaths: string[] = [];
			if (app.config.client) configPaths.push(app.config.client);
			if (app.config.server) configPaths.push(app.config.server);

			// Sniff each config file
			for (const configPath of configPaths) {
				const result = await sniffEntryFile(
					configPath,
					app.path,
					workspacePath,
					run,
				);

				if (logWarnings && result.error) {
					output.warn(
						`[sniffer] ${appName}: Config file "${configPath}" threw error during sniffing (env vars still captured): ${result.error.message}`,
					);
				}

				sniffedVars.push(...result.envVars);
				sniffedOptional.push(...result.optionalEnvVars);
			}

			const optionalEnvVars = [...new Set(sniffedOptional)];
			// Combine: dependency vars + sniffed vars (deduplicated)
			const allVars = applyMarkOptional(
				[...new Set([...depVars, ...sniffedVars])],
				optionalEnvVars,
				markOptional,
			);
			return { appName, requiredEnvVars: allVars, optionalEnvVars };
		}

		return { appName, requiredEnvVars: depVars, optionalEnvVars: [] };
	}

	// 2. Entry apps - import entry file in subprocess to trigger config.parse()
	if (app.entry) {
		const result = await sniffEntryFile(
			app.entry,
			app.path,
			workspacePath,
			run,
		);

		if (logWarnings && result.error) {
			output.warn(
				`[sniffer] ${appName}: Entry file threw error during sniffing (env vars still captured): ${result.error.message}`,
			);
		}

		return {
			appName,
			requiredEnvVars: applyMarkOptional(
				result.envVars,
				result.optionalEnvVars,
				markOptional,
			),
			optionalEnvVars: result.optionalEnvVars,
		};
	}

	// 4. Route-based apps - load routes and call getEnvironment() on each construct
	if (app.routes) {
		const result = await sniffRouteFiles(
			normalizeRoutes(app.routes),
			app.path,
			workspacePath,
			run,
		);

		if (logWarnings && result.error) {
			output.warn(
				`[sniffer] ${appName}: Route sniffing threw error (env vars still captured): ${result.error.message}`,
			);
		}

		return {
			appName,
			requiredEnvVars: applyMarkOptional(
				result.envVars,
				result.optionalEnvVars,
				markOptional,
			),
			optionalEnvVars: result.optionalEnvVars,
		};
	}

	// 5. Apps with envParser but no routes - run sniffer to detect env var usage
	if (app.envParser) {
		const result = await sniffEnvParser(
			app.envParser,
			app.path,
			workspacePath,
			run,
		);

		// Log any issues for debugging
		if (logWarnings) {
			if (result.error) {
				output.warn(
					`[sniffer] ${appName}: envParser threw error during sniffing (env vars still captured): ${result.error.message}`,
				);
			}
			if (result.unhandledRejections.length > 0) {
				output.warn(
					`[sniffer] ${appName}: Fire-and-forget rejections during sniffing (suppressed): ${result.unhandledRejections.map((e) => e.message).join(', ')}`,
				);
			}
		}

		return {
			appName,
			requiredEnvVars: applyMarkOptional(
				result.envVars,
				result.optionalEnvVars,
				markOptional,
			),
			optionalEnvVars: result.optionalEnvVars,
		};
	}

	// No env detection method available
	return { appName, requiredEnvVars: [], optionalEnvVars: [] };
}

/**
 * Apply the `?` suffix to optional variables in an env var list.
 * Only modifies the list when `markOptional` is true and there are optional vars.
 */
function applyMarkOptional(
	envVars: string[],
	optionalEnvVars: string[],
	markOptional: boolean,
): string[] {
	if (!markOptional || optionalEnvVars.length === 0) return envVars;
	const optionalSet = new Set(optionalEnvVars);
	return envVars.map((v) => (optionalSet.has(v) ? `${v}?` : v));
}

/**
 * Result from sniffing an entry file.
 */
interface EntrySniffResult {
	envVars: string[];
	optionalEnvVars: string[];
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
	run: SniffRun = {},
): Promise<EntrySniffResult> {
	const fullEntryPath = resolve(workspacePath, appPath, entryPath);
	const loaderPath = resolveSnifferFile('sniffer-loader');
	const workerPath = resolveSnifferFile('sniffer-worker');

	// tsx first — each `.tsx` compiled by its own tsconfig's JSX settings
	// rather than whatever the app's tsconfig includes — then the loader that
	// swaps in the sniffing EnvironmentParser.
	const ran = await runSniffer(
		run,
		workspacePath,
		resolve(workspacePath, appPath),
		nodeWithTsx(workerPath, [fullEntryPath], [loaderPath]),
	);
	if ('error' in ran)
		return { envVars: [], optionalEnvVars: [], error: ran.error };

	const answer = snifferAnswer(ran.stdout);
	if (answer) {
		return {
			envVars: answer.envVars || [],
			optionalEnvVars: answer.optionalEnvVars || [],
			error: answer.error ? new Error(answer.error) : undefined,
		};
	}

	// If we couldn't parse the output, return empty with error info
	return {
		envVars: [],
		optionalEnvVars: [],
		error: new Error(
			`Failed to sniff entry file (exit code ${ran.code}): ${ran.stderr || ran.stdout || 'No output'}`,
		),
	};
}

/**
 * Sniff route files by loading constructs and calling getEnvironment().
 *
 * Route-based apps have endpoints, functions, crons, and subscribers that
 * use services. Each service's register() method accesses environment variables.
 *
 * This runs in a subprocess with tsx loader to properly handle TypeScript
 * compilation and path alias resolution (e.g., `src/...` imports).
 *
 * @param routes - Glob pattern(s) for route files
 * @param appPath - The app's path relative to workspace (e.g., 'apps/api')
 * @param workspacePath - Absolute path to workspace root
 * @returns EntrySniffResult with env vars and optional error
 */
async function sniffRouteFiles(
	routes: string | string[],
	appPath: string,
	workspacePath: string,
	run: SniffRun = {},
): Promise<EntrySniffResult> {
	const fullAppPath = resolve(workspacePath, appPath);
	const workerPath = resolveSnifferFile('sniffer-routes-worker');

	// Convert array of patterns to first pattern (worker handles glob internally)
	const routesArray = Array.isArray(routes) ? routes : [routes];
	const pattern = routesArray[0];
	if (!pattern) {
		return {
			envVars: [],
			optionalEnvVars: [],
			error: new Error('No route patterns provided'),
		};
	}

	const ran = await runSniffer(
		run,
		workspacePath,
		fullAppPath,
		nodeWithTsx(workerPath, [fullAppPath, pattern]),
	);
	if ('error' in ran)
		return { envVars: [], optionalEnvVars: [], error: ran.error };

	// Log any stderr output (import errors, etc.)
	if (ran.stderr) {
		ran.stderr
			.split('\n')
			.filter((line) => line.trim())
			.forEach((line) => output.warn(line));
	}

	const answer = snifferAnswer(ran.stdout);
	if (answer) {
		return {
			envVars: answer.envVars || [],
			optionalEnvVars: answer.optionalEnvVars || [],
			error: answer.error ? new Error(answer.error) : undefined,
		};
	}

	// If we couldn't parse the output, return empty with error info
	return {
		envVars: [],
		optionalEnvVars: [],
		error: new Error(
			`Failed to sniff route files (exit code ${ran.code}): ${ran.stderr || ran.stdout || 'No output'}`,
		),
	};
}

/**
 * Run the SnifferEnvironmentParser on an envParser module to detect
 * which environment variables it accesses.
 *
 * In a subprocess, like the entry and route sniffers: the module is the
 * project's code, and it was imported into the deploy itself before — with
 * every credential the deploy held in reach. Fire-and-forget rejections are
 * collected there with the shared `sniffWithFireAndForget`.
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
	run: SniffRun = {},
): Promise<SniffResult> {
	// Parse the envParser path: './src/config/env#envParser' or './src/config/env'
	const [modulePath, exportName = 'default'] = envParserPath.split('#');
	if (!modulePath) {
		return { envVars: [], optionalEnvVars: [], unhandledRejections: [] };
	}

	const appRoot = resolve(workspacePath, appPath);
	const fullPath = resolve(appRoot, modulePath);
	const workerPath = resolveSnifferFile('sniffer-envparser-worker');

	const ran = await runSniffer(
		run,
		workspacePath,
		appRoot,
		nodeWithTsx(workerPath, [fullPath, exportName]),
	);
	if ('error' in ran) {
		return {
			envVars: [],
			optionalEnvVars: [],
			unhandledRejections: [],
			error: ran.error,
		};
	}

	const answer = snifferAnswer(ran.stdout);
	if (!answer) {
		return {
			envVars: [],
			optionalEnvVars: [],
			unhandledRejections: [],
			error: new Error(
				`Failed to sniff envParser (exit code ${ran.code}): ${ran.stderr || ran.stdout || 'No output'}`,
			),
		};
	}

	for (const warning of answer.warnings ?? []) output.warn(warning);

	return {
		envVars: answer.envVars ?? [],
		optionalEnvVars: answer.optionalEnvVars ?? [],
		unhandledRejections: (answer.unhandledRejections ?? []).map(
			(message) => new Error(message),
		),
		...(answer.error ? { error: new Error(answer.error) } : {}),
	};
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
export {
	sniffEnvParser as _sniffEnvParser,
	sniffEntryFile as _sniffEntryFile,
	sniffRouteFiles as _sniffRouteFiles,
};
