import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Construct } from '@geekmidas/constructs';

/**
 * Banner to inject into ESM bundle for CJS compatibility.
 * Creates a `require` function using Node's createRequire for packages
 * that internally use CommonJS require() for Node builtins.
 */
const ESM_CJS_COMPAT_BANNER =
	'import { createRequire } from "module"; const require = createRequire(import.meta.url);';

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
 * Bundle the server application using esbuild.
 * Creates a fully standalone bundle with all dependencies included.
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

	const mjsOutput = join(outputDir, 'server.mjs');

	// Build command-line arguments for esbuild
	const args = [
		'npx',
		'esbuild',
		entryPoint,
		'--bundle',
		'--platform=node',
		'--target=node22',
		'--format=esm',
		`--outfile=${mjsOutput}`,
		'--packages=bundle', // Bundle all dependencies for standalone output
		`--banner:js=${ESM_CJS_COMPAT_BANNER}`, // CJS compatibility for packages like pino
	];

	if (minify) {
		args.push('--minify');
	}

	if (sourcemap) {
		args.push('--sourcemap');
	}

	// Add external packages (user-specified)
	for (const ext of external) {
		args.push(`--external:${ext}`);
	}

	// Handle secrets injection if stage is provided
	let masterKey: string | undefined;

	if (stage) {
		const {
			readStageSecrets,
			toEmbeddableSecrets,
			validateEnvironmentVariables,
			initStageSecrets,
			writeStageSecrets,
		} = await import('../secrets/storage');
		const { encryptSecrets, generateDefineOptions } = await import(
			'../secrets/encryption'
		);

		let secrets = await readStageSecrets(stage);

		if (!secrets) {
			// Auto-initialize secrets for the stage
			console.log(`  Initializing secrets for stage "${stage}"...`);
			secrets = initStageSecrets(stage);
			await writeStageSecrets(secrets);
			console.log(`  ✓ Created .gkm/secrets/${stage}.json`);
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

		// Add define options for build-time injection using esbuild's --define:KEY=VALUE format
		const defines = generateDefineOptions(encrypted);
		for (const [key, value] of Object.entries(defines)) {
			args.push(`--define:${key}=${JSON.stringify(value)}`);
		}

		console.log(`  Secrets encrypted for stage "${stage}"`);
	}

	try {
		// Run esbuild with command-line arguments
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
			throw new Error(`esbuild exited with code ${result.status}`);
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
