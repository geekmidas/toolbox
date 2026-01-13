import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Construct } from '@geekmidas/constructs';

export interface BundleOptions {
	/** Entry point file (e.g., .gkm/server/server.ts) */
	entryPoint: string;
	/** Output directory for bundled files */
	outputDir: string;
	/** Minify the output (default: true) */
	minify: boolean;
	/** Generate sourcemaps (default: false) */
	sourcemap: boolean;
	/** Packages to exclude from bundling */
	external: string[];
	/** Stage for secrets injection (optional) */
	stage?: string;
	/** Constructs to validate environment variables for */
	constructs?: Construct[];
	/** Docker compose services configured (for auto-populating env vars) */
	dockerServices?: {
		postgres?: boolean;
		redis?: boolean;
		rabbitmq?: boolean;
	};
}

export interface BundleResult {
	/** Path to the bundled output */
	outputPath: string;
	/** Ephemeral master key for deployment (only if stage was provided) */
	masterKey?: string;
}

/**
 * Collect all required environment variables from constructs.
 * Uses the SnifferEnvironmentParser to detect which env vars each service needs.
 *
 * @param constructs - Array of constructs to analyze
 * @returns Deduplicated array of required environment variable names
 */
async function collectRequiredEnvVars(
	constructs: Construct[],
): Promise<string[]> {
	const allEnvVars = new Set<string>();

	for (const construct of constructs) {
		const envVars = await construct.getEnvironment();
		envVars.forEach((v) => allEnvVars.add(v));
	}

	return Array.from(allEnvVars).sort();
}

/**
 * Bundle the server application using tsdown
 *
 * @param options - Bundle configuration options
 * @returns Bundle result with output path and optional master key
 */
/** Default env var values for docker compose services */
const DOCKER_SERVICE_ENV_VARS: Record<string, Record<string, string>> = {
	postgres: {
		DATABASE_URL: 'postgresql://postgres:postgres@postgres:5432/app',
	},
	redis: {
		REDIS_URL: 'redis://redis:6379',
	},
	rabbitmq: {
		RABBITMQ_URL: 'amqp://rabbitmq:5672',
	},
};

export async function bundleServer(
	options: BundleOptions,
): Promise<BundleResult> {
	const {
		entryPoint,
		outputDir,
		minify,
		sourcemap,
		external,
		stage,
		constructs,
		dockerServices,
	} = options;

	// Ensure output directory exists
	await mkdir(outputDir, { recursive: true });

	// Build command-line arguments for tsdown
	const args = [
		'npx',
		'tsdown',
		entryPoint,
		'--no-config', // Don't use any config file from workspace
		'--out-dir',
		outputDir,
		'--format',
		'esm',
		'--platform',
		'node',
		'--target',
		'node22',
		'--clean',
	];

	if (minify) {
		args.push('--minify');
	}

	if (sourcemap) {
		args.push('--sourcemap');
	}

	// Add external packages
	for (const ext of external) {
		args.push('--external', ext);
	}

	// Always exclude node: builtins
	args.push('--external', 'node:*');

	// Handle secrets injection if stage is provided
	let masterKey: string | undefined;

	if (stage) {
		const {
			readStageSecrets,
			toEmbeddableSecrets,
			validateEnvironmentVariables,
		} = await import('../secrets/storage');
		const { encryptSecrets, generateDefineOptions } = await import(
			'../secrets/encryption'
		);

		const secrets = await readStageSecrets(stage);

		if (!secrets) {
			throw new Error(
				`No secrets found for stage "${stage}". Run "gkm secrets:init --stage ${stage}" first.`,
			);
		}

		// Auto-populate env vars from docker compose services
		if (dockerServices) {
			for (const [service, enabled] of Object.entries(dockerServices)) {
				if (enabled && DOCKER_SERVICE_ENV_VARS[service]) {
					for (const [envVar, defaultValue] of Object.entries(
						DOCKER_SERVICE_ENV_VARS[service],
					)) {
						// Check if not already in urls or custom
						const urlKey = envVar as keyof typeof secrets.urls;
						if (!secrets.urls[urlKey] && !secrets.custom[envVar]) {
							secrets.urls[urlKey] = defaultValue;
							console.log(`  Auto-populated ${envVar} from docker compose`);
						}
					}
				}
			}
		}

		// Validate environment variables if constructs are provided
		if (constructs && constructs.length > 0) {
			console.log('  Analyzing environment variable requirements...');
			const requiredVars = await collectRequiredEnvVars(constructs);

			if (requiredVars.length > 0) {
				const validation = validateEnvironmentVariables(requiredVars, secrets);

				if (!validation.valid) {
					const errorMessage = [
						`Missing environment variables for stage "${stage}":`,
						'',
						...validation.missing.map((v) => `  ❌ ${v}`),
						'',
						'To fix this, either:',
						`  1. Add the missing variables to .gkm/secrets/${stage}.json using:`,
						`     gkm secrets:set <KEY> <VALUE> --stage ${stage}`,
						'',
						`  2. Or import from a JSON file:`,
						`     gkm secrets:import secrets.json --stage ${stage}`,
						'',
						'Required variables:',
						...validation.required.map((v) =>
							validation.missing.includes(v) ? `  ❌ ${v}` : `  ✓ ${v}`,
						),
					].join('\n');

					throw new Error(errorMessage);
				}

				console.log(
					`  ✓ All ${requiredVars.length} required environment variables found`,
				);
			}
		}

		// Convert to embeddable format and encrypt
		const embeddable = toEmbeddableSecrets(secrets);
		const encrypted = encryptSecrets(embeddable);
		masterKey = encrypted.masterKey;

		// Add define options for build-time injection using tsdown's --env.* format
		const defines = generateDefineOptions(encrypted);
		for (const [key, value] of Object.entries(defines)) {
			args.push(`--env.${key}`, value);
		}

		console.log(`  Secrets encrypted for stage "${stage}"`);
	}

	const mjsOutput = join(outputDir, 'server.mjs');

	try {
		// Run tsdown with command-line arguments
		// Use spawnSync with args array to avoid shell escaping issues with --define values
		// args is always populated with ['npx', 'tsdown', ...] so cmd is never undefined
		const [cmd, ...cmdArgs] = args as [string, ...string[]];
		const result = spawnSync(cmd, cmdArgs, {
			cwd: process.cwd(),
			stdio: 'inherit',
			shell: process.platform === 'win32', // Only use shell on Windows for npx resolution
		});

		if (result.error) {
			throw result.error;
		}
		if (result.status !== 0) {
			throw new Error(`tsdown exited with code ${result.status}`);
		}

		// Rename output to .mjs for explicit ESM
		// tsdown outputs as server.js for ESM format
		const jsOutput = join(outputDir, 'server.js');

		if (existsSync(jsOutput)) {
			await rename(jsOutput, mjsOutput);
		}

		// Add shebang to the bundled file
		const { readFile } = await import('node:fs/promises');
		const content = await readFile(mjsOutput, 'utf-8');
		if (!content.startsWith('#!')) {
			await writeFile(mjsOutput, `#!/usr/bin/env node\n${content}`);
		}
	} catch (error) {
		throw new Error(
			`Failed to bundle server: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
	}

	return {
		outputPath: mjsOutput,
		masterKey,
	};
}
