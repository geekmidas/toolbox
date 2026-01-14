import { spawn } from 'node:child_process';
import { readStageSecrets, toEmbeddableSecrets } from '../secrets/storage';

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
 * Run tests with secrets loaded from the specified stage.
 * Secrets are decrypted and injected into the environment.
 */
export async function testCommand(options: TestOptions = {}): Promise<void> {
	const stage = options.stage ?? 'development';

	console.log(`\n🧪 Running tests with ${stage} secrets...\n`);

	// Load and decrypt secrets
	let envVars: Record<string, string> = {};
	try {
		const secrets = await readStageSecrets(stage);
		if (secrets) {
			envVars = toEmbeddableSecrets(secrets);
			console.log(
				`  Loaded ${Object.keys(envVars).length} secrets from ${stage}\n`,
			);
		} else {
			console.log(`  No secrets found for ${stage}, running without secrets\n`);
		}
	} catch (error) {
		if (error instanceof Error && error.message.includes('key not found')) {
			console.log(
				`  Decryption key not found for ${stage}, running without secrets\n`,
			);
		} else {
			throw error;
		}
	}

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

	// Run vitest with secrets in environment
	const vitestProcess = spawn('npx', ['vitest', ...args], {
		cwd: process.cwd(),
		stdio: 'inherit',
		env: {
			...process.env,
			...envVars,
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
