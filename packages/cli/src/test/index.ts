import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	createCredentialsPreload,
	loadEnvFiles,
	prepareEntryCredentials,
} from '../credentials';
import { sniffAppEnvironment } from '../deploy/sniffer';

export interface TestOptions {
	/** Stage to load secrets from (default: development) */
	stage?: string;
	/** Run tests once without watch mode */
	run?: boolean;
	/** Enable watch mode */
	watch?: boolean;
	/** Generate coverage report */
	coverage?: boolean;
	/** Open Vitest UI */
	ui?: boolean;
	/** Pattern to filter tests */
	pattern?: string;
}

/**
 * Run tests with secrets, dependency URLs, and .env files loaded.
 * Environment variables are sniffed to inject only what the app needs.
 */
export async function testCommand(options: TestOptions = {}): Promise<void> {
	const stage = options.stage ?? 'development';
	const cwd = process.cwd();

	console.log(`\n🧪 Running tests with ${stage} environment...\n`);

	// 1. Load .env files
	const defaultEnv = loadEnvFiles('.env');
	if (defaultEnv.loaded.length > 0) {
		console.log(`  📦 Loaded env: ${defaultEnv.loaded.join(', ')}`);
	}

	// 2. Prepare credentials: loads secrets, resolves Docker ports,
	//    starts services, rewrites URLs, injects dependency URLs
	const result = await prepareEntryCredentials({
		stages: [stage],
		startDocker: true,
		secretsFileName: 'test-secrets.json',
		resolveDockerPorts: 'full',
	});

	let finalCredentials = { ...result.credentials };

	// 3. Sniff env vars to filter only what the app needs (workspace only)
	if (result.appInfo) {
		const sniffed = await sniffAppEnvironment(
			result.appInfo.app,
			result.appInfo.appName,
			result.appInfo.workspaceRoot,
			{ logWarnings: false },
		);

		if (sniffed.requiredEnvVars.length > 0) {
			const needed = new Set(sniffed.requiredEnvVars);
			const filtered: Record<string, string> = {};
			for (const [key, value] of Object.entries(finalCredentials)) {
				if (needed.has(key)) {
					filtered[key] = value;
				}
			}
			finalCredentials = filtered;
			console.log(
				`  🔍 Sniffed ${sniffed.requiredEnvVars.length} required env var(s)`,
			);
		}
	}

	// 4. Rewrite DATABASE_URL for test isolation (append _test suffix)
	finalCredentials = rewriteDatabaseUrlForTests(finalCredentials);

	console.log('');

	// 5. Write final credentials and create preload script
	await writeFile(
		result.secretsJsonPath,
		JSON.stringify(finalCredentials, null, 2),
	);

	const gkmDir = join(cwd, '.gkm');
	const preloadPath = join(gkmDir, 'test-credentials-preload.ts');
	await createCredentialsPreload(preloadPath, result.secretsJsonPath);

	// Merge NODE_OPTIONS with existing value (if any)
	const existingNodeOptions = process.env.NODE_OPTIONS ?? '';
	const tsxImport = '--import=tsx';
	const preloadImport = `--import=${preloadPath}`;
	const nodeOptions = [existingNodeOptions, tsxImport, preloadImport]
		.filter(Boolean)
		.join(' ');

	// Build vitest args
	const args: string[] = [];

	if (options.run) {
		args.push('run');
	} else if (options.watch) {
		args.push('--watch');
	}

	if (options.coverage) {
		args.push('--coverage');
	}

	if (options.ui) {
		args.push('--ui');
	}

	if (options.pattern) {
		args.push(options.pattern);
	}

	// Run vitest with combined environment and credentials preload
	const vitestProcess = spawn('npx', ['vitest', ...args], {
		cwd,
		stdio: 'inherit',
		env: {
			...process.env,
			...finalCredentials,
			NODE_ENV: 'test',
			NODE_OPTIONS: nodeOptions,
		},
	});

	// Wait for vitest to complete
	return new Promise((resolve, reject) => {
		vitestProcess.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Tests failed with exit code ${code}`));
			}
		});

		vitestProcess.on('error', (error) => {
			reject(error);
		});
	});
}

const TEST_DB_SUFFIX = '_test';

/**
 * Rewrite DATABASE_URL to point to a separate test database.
 * Appends `_test` to the database name (e.g., `app` -> `app_test`).
 * @internal Exported for testing
 */
export function rewriteDatabaseUrlForTests(
	env: Record<string, string>,
): Record<string, string> {
	const result = { ...env };

	for (const key of Object.keys(result)) {
		if (!key.includes('DATABASE_URL')) continue;

		const value = result[key] as string;
		try {
			const url = new URL(value);
			const dbName = url.pathname.slice(1);
			if (dbName && !dbName.endsWith(TEST_DB_SUFFIX)) {
				url.pathname = `/${dbName}${TEST_DB_SUFFIX}`;
				result[key] = url.toString();
				console.log(
					`  🧪 ${key}: using test database "${dbName}${TEST_DB_SUFFIX}"`,
				);
			}
		} catch {
			// Not a valid URL, skip
		}
	}

	return result;
}
