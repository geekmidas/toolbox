import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadWorkspaceAppInfo } from '../config';
import {
	createCredentialsPreload,
	loadEnvFiles,
	loadPortState,
	parseComposePortMappings,
	resolveServicePorts,
	rewriteUrlsWithPorts,
	startComposeServices,
	startWorkspaceServices,
} from '../credentials';
import { sniffAppEnvironment } from '../deploy/sniffer';
import { readStageSecrets, toEmbeddableSecrets } from '../secrets/storage';
import { getDependencyEnvVars } from '../workspace/index';

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

	// 2. Load and decrypt secrets
	let secretsEnv: Record<string, string> = {};
	try {
		const secrets = await readStageSecrets(stage);
		if (secrets) {
			secretsEnv = toEmbeddableSecrets(secrets);
			console.log(
				`  🔐 Loaded ${Object.keys(secretsEnv).length} secrets from ${stage}`,
			);
		} else {
			console.log(`  No secrets found for ${stage}`);
		}
	} catch (error) {
		if (error instanceof Error && error.message.includes('key not found')) {
			console.log(`  Decryption key not found for ${stage}`);
		} else {
			throw error;
		}
	}

	// 3. Load workspace config + start Docker services with secrets
	let dependencyEnv: Record<string, string> = {};
	try {
		const appInfo = await loadWorkspaceAppInfo(cwd);

		// Resolve ports and start Docker services with secrets so that
		// POSTGRES_USER, POSTGRES_PASSWORD, etc. are interpolated correctly
		const resolvedPorts = await resolveServicePorts(appInfo.workspaceRoot);
		await startWorkspaceServices(
			appInfo.workspace,
			resolvedPorts.dockerEnv,
			secretsEnv,
		);

		// Rewrite URLs with resolved Docker ports and hostnames
		if (resolvedPorts.mappings.length > 0) {
			secretsEnv = rewriteUrlsWithPorts(secretsEnv, resolvedPorts);
			console.log(
				`  🔌 Applied ${Object.keys(resolvedPorts.ports).length} port mapping(s)`,
			);
		}

		dependencyEnv = getDependencyEnvVars(appInfo.workspace, appInfo.appName);

		if (Object.keys(dependencyEnv).length > 0) {
			console.log(
				`  🔗 Loaded ${Object.keys(dependencyEnv).length} dependency URL(s)`,
			);
		}

		// Sniff to detect which env vars the app needs
		const sniffed = await sniffAppEnvironment(
			appInfo.app,
			appInfo.appName,
			appInfo.workspaceRoot,
			{ logWarnings: false },
		);

		// Filter to only include what the app needs
		if (sniffed.requiredEnvVars.length > 0) {
			const needed = new Set(sniffed.requiredEnvVars);
			const allEnv = { ...secretsEnv, ...dependencyEnv };
			const filteredEnv: Record<string, string> = {};
			for (const [key, value] of Object.entries(allEnv)) {
				if (needed.has(key)) {
					filteredEnv[key] = value;
				}
			}
			secretsEnv = {};
			dependencyEnv = filteredEnv;
			console.log(
				`  🔍 Sniffed ${sniffed.requiredEnvVars.length} required env var(s)`,
			);
		}
	} catch {
		// Not in a workspace — start Docker services from local docker-compose.yml
		const composePath = join(cwd, 'docker-compose.yml');
		const mappings = parseComposePortMappings(composePath);
		if (mappings.length > 0) {
			const resolvedPorts = await resolveServicePorts(cwd);
			await startComposeServices(cwd, resolvedPorts.dockerEnv, secretsEnv);

			if (resolvedPorts.mappings.length > 0) {
				secretsEnv = rewriteUrlsWithPorts(secretsEnv, resolvedPorts);
				console.log(
					`  🔌 Applied ${Object.keys(resolvedPorts.ports).length} port mapping(s)`,
				);
			} else {
				// Fallback to saved port state from a previous gkm dev run
				const ports = await loadPortState(cwd);
				if (Object.keys(ports).length > 0) {
					secretsEnv = rewriteUrlsWithPorts(secretsEnv, {
						dockerEnv: {},
						ports,
						mappings,
					});
					console.log(
						`  🔌 Applied ${Object.keys(ports).length} port mapping(s)`,
					);
				}
			}
		}
	}

	// 4. Use a separate test database (append _test suffix)
	secretsEnv = rewriteDatabaseUrlForTests(secretsEnv);

	console.log('');

	// Write combined secrets to JSON and create credentials preload
	const allSecrets = { ...secretsEnv, ...dependencyEnv };
	const gkmDir = join(cwd, '.gkm');
	await mkdir(gkmDir, { recursive: true });
	const secretsJsonPath = join(gkmDir, 'test-secrets.json');
	await writeFile(secretsJsonPath, JSON.stringify(allSecrets, null, 2));

	const preloadPath = join(gkmDir, 'test-credentials-preload.ts');
	await createCredentialsPreload(preloadPath, secretsJsonPath);

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
			...allSecrets,
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
