import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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
}

export interface BundleResult {
	/** Path to the bundled output */
	outputPath: string;
	/** Ephemeral master key for deployment (only if stage was provided) */
	masterKey?: string;
}

/**
 * The esbuild binary, resolved from this package rather than from PATH.
 *
 * It used to be `npx esbuild`, which is two assumptions: that esbuild is
 * installed somewhere npx can find, and that the *app's* directory is where to
 * look. Neither holds — the CLI did not depend on esbuild at all, so a deploy
 * run from an app that had not installed it failed at the bundle step with
 * `sh: esbuild: command not found`, after provisioning had already happened.
 *
 * The same fix `bin/gkm.mjs` makes for tsx: resolve from this package's own
 * `node_modules`, so the tool the CLI shells out to is the one it depends on.
 */
function esbuildBinary(): string {
	const require = createRequire(import.meta.url);

	try {
		// The package root, then its bin — `require.resolve('esbuild')` gives the
		// JS entry point, which is a library rather than the CLI.
		const pkg = require.resolve('esbuild/package.json');
		return join(dirname(pkg), 'bin', 'esbuild');
	} catch {
		// Better a PATH lookup than a hard failure: a project that installed
		// esbuild itself still works.
		return 'esbuild';
	}
}

/**
 * Collect the environment variables a build cannot proceed without.
 *
 * Uses the SnifferEnvironmentParser to detect which env vars each service
 * reads, and keeps only the ones it cannot do without. `markOptional` is what
 * separates them: the sniffer already knows which reads went through
 * `.optional()` or `.default()`, and asking for that distinction is the
 * difference between a build that stops and one that proceeds correctly.
 *
 * Without it, a key that is *absent by design* failed the build. A surface
 * publishes `AUTH_COOKIE_DOMAIN` only when there is a domain to widen a cookie
 * to — one host has nothing to share it with, so the derivation correctly
 * yields nothing, and Better Auth reads it as optional for exactly that
 * reason. Treating every sniffed read as required made the honest answer
 * indistinguishable from a missing secret.
 *
 * @param constructs - Array of constructs to analyze
 * @returns Deduplicated, sorted names of the required variables
 */
async function collectRequiredEnvVars(
	constructs: Construct[],
): Promise<string[]> {
	// A key read optionally by one construct and required by another stays
	// required: the strictest read is the one that fails at runtime, and taking
	// the union of the required reads is what says so.
	const required = new Set<string>();

	for (const construct of constructs) {
		for (const name of await construct.getEnvironment({ markOptional: true })) {
			if (!name.endsWith('?')) required.add(name);
		}
	}

	return Array.from(required).sort();
}

/**
 * Bundle the server application using esbuild.
 * Creates a fully standalone bundle with all dependencies included.
 *
 * @param options - Bundle configuration options
 * @returns Bundle result with output path and optional master key
 */

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
	} = options;

	// Ensure output directory exists
	await mkdir(outputDir, { recursive: true });

	const mjsOutput = join(outputDir, 'server.mjs');

	// Build command-line arguments for esbuild
	const args = [
		esbuildBinary(),
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
