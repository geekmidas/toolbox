import { spawn } from 'node:child_process';
import { loadAppConfig } from '../config';
import { loadEnvFiles } from '../dev/index';
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

	// 3. Load workspace config + dependency URLs + sniff env vars
	let dependencyEnv: Record<string, string> = {};
	try {
		const appConfig = await loadAppConfig(cwd);
		dependencyEnv = getDependencyEnvVars(
			appConfig.workspace,
			appConfig.appName,
		);

		if (Object.keys(dependencyEnv).length > 0) {
			console.log(
				`  🔗 Loaded ${Object.keys(dependencyEnv).length} dependency URL(s)`,
			);
		}

		// 4. Sniff to detect which env vars the app needs
		const sniffed = await sniffAppEnvironment(
			appConfig.app,
			appConfig.appName,
			appConfig.workspaceRoot,
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
		// Not in a workspace — continue with just secrets
	}

	console.log('');

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

	// Run vitest with combined environment
	const vitestProcess = spawn('npx', ['vitest', ...args], {
		cwd,
		stdio: 'inherit',
		env: {
			...process.env,
			...secretsEnv,
			...dependencyEnv,
			// Ensure NODE_ENV is set to test
			NODE_ENV: 'test',
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
