import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
}

export interface BundleResult {
	/** Path to the bundled output */
	outputPath: string;
	/** Ephemeral master key for deployment (only if stage was provided) */
	masterKey?: string;
}

/**
 * Bundle the server application using tsdown
 *
 * @param options - Bundle configuration options
 * @returns Bundle result with output path and optional master key
 */
export async function bundleServer(
	options: BundleOptions,
): Promise<BundleResult> {
	const { entryPoint, outputDir, minify, sourcemap, external, stage } = options;

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
		const { readStageSecrets, toEmbeddableSecrets } = await import(
			'../secrets/storage'
		);
		const { encryptSecrets, generateDefineOptions } = await import(
			'../secrets/encryption'
		);

		const secrets = await readStageSecrets(stage);

		if (!secrets) {
			throw new Error(
				`No secrets found for stage "${stage}". Run "gkm secrets:init --stage ${stage}" first.`,
			);
		}

		// Convert to embeddable format and encrypt
		const embeddable = toEmbeddableSecrets(secrets);
		const encrypted = encryptSecrets(embeddable);
		masterKey = encrypted.masterKey;

		// Add define options for build-time injection
		const defines = generateDefineOptions(encrypted);
		for (const [key, value] of Object.entries(defines)) {
			args.push('--define', `${key}=${value}`);
		}

		console.log(`  Secrets encrypted for stage "${stage}"`);
	}

	const mjsOutput = join(outputDir, 'server.mjs');

	try {
		// Run tsdown with command-line arguments
		execSync(args.join(' '), {
			cwd: process.cwd(),
			stdio: 'inherit',
		});

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
