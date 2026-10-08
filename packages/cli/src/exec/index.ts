import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	createCredentialsPreload,
	loadEnvFiles,
	prepareEntryCredentials,
} from '../credentials';
import { imageBuildCredentials, isImageBuild } from './imageBuild';

const logger = console;

/** `gkm exec` was given nothing to run. */
export class NoCommandSpecified extends Error {
	constructor() {
		super('No command specified. Usage: gkm exec -- <command>');
		this.name = 'NoCommandSpecified';
	}
}

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

	if (!commandArgs[0]) {
		throw new NoCommandSpecified();
	}

	// Load .env files
	const defaultEnv = loadEnvFiles('.env');
	if (defaultEnv.loaded.length > 0) {
		logger.log(`📦 Loaded env: ${defaultEnv.loaded.join(', ')}`);
	}

	// Prepare credentials: loads secrets, resolves Docker ports, rewrites URLs,
	// injects dependency URLs. Uses readonly port mode (no probing for new ports).
	//
	// Inside an image build there is none of that to do: the build args are the
	// stage's public values, and nothing on a developer's machine is reachable.
	const { credentials, secretsJsonPath, appName } = isImageBuild()
		? await imageBuildEntry(cwd)
		: await prepareEntryCredentials({ cwd });

	if (appName) {
		logger.log(`📦 App: ${appName}`);
	}

	const secretCount = Object.keys(credentials).filter(
		(k) => k !== 'PORT',
	).length;
	if (secretCount > 0 && !isImageBuild()) {
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
	const [cmd, ...args] = commandArgs as [string, ...string[]];

	logger.log(`🚀 Running: ${[cmd, ...args].join(' ')}`);

	// Build NODE_OPTIONS for the child process.
	// Strip any --import flags from the inherited NODE_OPTIONS — the gkm binary
	// adds --import=tsx for itself, but the spawned command (e.g. next, prisma)
	// doesn't need it and it breaks frameworks that spawn their own workers.
	const existingNodeOptions = (process.env.NODE_OPTIONS ?? '')
		.replace(/--import[= ]\S+/g, '')
		.trim();
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

/**
 * `gkm exec` inside an image build: the public values the Dockerfile's build
 * args set, written where the preload reads them. No workspace is loaded, no
 * secret read and no address resolved.
 */
async function imageBuildEntry(cwd: string): Promise<{
	credentials: Record<string, string>;
	secretsJsonPath: string;
	appName?: string;
}> {
	const credentials = imageBuildCredentials();
	logger.log(
		`🐳 Image build: ${Object.keys(credentials).length} public value(s) from the build args`,
	);
	const dir = join(cwd, '.gkm');
	await mkdir(dir, { recursive: true });
	const secretsJsonPath = join(dir, 'image-build-env.json');
	await writeFile(secretsJsonPath, JSON.stringify(credentials, null, 2));
	return { credentials, secretsJsonPath };
}
