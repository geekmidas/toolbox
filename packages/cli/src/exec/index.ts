import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
	createCredentialsPreload,
	loadEnvFiles,
	prepareEntryCredentials,
} from '../credentials';

const logger = console;

/**
 * Options for the exec command.
 */
export interface ExecOptions {
	/** Working directory */
	cwd?: string;
}

/**
 * Run a command with secrets injected into Credentials.
 * Uses Node's --import flag to preload a script that populates Credentials
 * before the command loads any modules that depend on them.
 *
 * @example
 * ```bash
 * gkm exec -- npx @better-auth/cli migrate
 * gkm exec -- npx prisma migrate dev
 * ```
 */
export async function execCommand(
	commandArgs: string[],
	options: ExecOptions = {},
): Promise<void> {
	const cwd = options.cwd ?? process.cwd();

	if (commandArgs.length === 0) {
		throw new Error('No command specified. Usage: gkm exec -- <command>');
	}

	// Load .env files
	const defaultEnv = loadEnvFiles('.env');
	if (defaultEnv.loaded.length > 0) {
		logger.log(`📦 Loaded env: ${defaultEnv.loaded.join(', ')}`);
	}

	// Prepare credentials: loads secrets, resolves Docker ports, rewrites URLs,
	// injects dependency URLs. Uses readonly port mode (no probing for new ports).
	const { credentials, secretsJsonPath, appName } =
		await prepareEntryCredentials({ cwd, resolveDockerPorts: 'readonly' });

	if (appName) {
		logger.log(`📦 App: ${appName}`);
	}

	const secretCount = Object.keys(credentials).filter(
		(k) => k !== 'PORT',
	).length;
	if (secretCount > 0) {
		logger.log(`🔐 Loaded ${secretCount} secret(s)`);
	}

	// Create preload script that injects Credentials
	// Written as .mjs (plain ESM) so it doesn't need tsx — this avoids
	// breaking frameworks like Next.js whose workers inherit NODE_OPTIONS.
	const preloadDir = join(cwd, '.gkm');
	await mkdir(preloadDir, { recursive: true });
	const preloadPath = join(preloadDir, 'credentials-preload.mjs');
	await createCredentialsPreload(preloadPath, secretsJsonPath);

	// Build command
	const [cmd, ...args] = commandArgs;

	if (!cmd) {
		throw new Error('No command specified');
	}

	logger.log(`🚀 Running: ${[cmd, ...args].join(' ')}`);

	// Merge NODE_OPTIONS with existing value (if any)
	// The preload is .mjs so no tsx loader needed — safe for frameworks
	// like Next.js whose workers inherit NODE_OPTIONS.
	const existingNodeOptions = process.env.NODE_OPTIONS ?? '';
	const preloadImport = `--import=${preloadPath}`;

	const nodeOptions = [existingNodeOptions, preloadImport]
		.filter(Boolean)
		.join(' ');

	// Spawn the command with secrets in both:
	// 1. Environment variables (for tools that read process.env directly)
	// 2. Preload script (for tools that use Credentials object)
	const child = spawn(cmd, args, {
		cwd,
		stdio: 'inherit',
		env: {
			...process.env,
			...credentials, // Inject secrets as env vars
			NODE_OPTIONS: nodeOptions,
		},
	});

	// Wait for the command to complete
	const exitCode = await new Promise<number>((resolve) => {
		child.on('close', (code: number | null) => resolve(code ?? 0));
		child.on('error', (error: Error) => {
			logger.error(`Failed to run command: ${error.message}`);
			resolve(1);
		});
	});

	if (exitCode !== 0) {
		process.exit(exitCode);
	}
}
