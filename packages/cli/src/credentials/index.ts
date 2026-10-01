import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import {
	getAppNameFromCwd,
	loadWorkspaceAppInfo,
	loadWorkspaceConfig,
	type WorkspaceAppInfo,
} from '../config';
import {
	readStageSecrets,
	secretsExist,
	toEmbeddableSecrets,
} from '../secrets/storage.js';
import type { NormalizedWorkspace } from '../workspace/index.js';

const logger = console;

// ---------------------------------------------------------------------------
// Environment files
// ---------------------------------------------------------------------------

/**
 * Load environment files
 * @internal Exported for testing
 */
export function loadEnvFiles(
	envConfig: string | string[] | undefined,
	cwd: string = process.cwd(),
): { loaded: string[]; missing: string[] } {
	const loaded: string[] = [];
	const missing: string[] = [];

	// Normalize to array
	const envFiles = envConfig
		? Array.isArray(envConfig)
			? envConfig
			: [envConfig]
		: ['.env'];

	// Load each env file in order (later files override earlier)
	for (const envFile of envFiles) {
		const envPath = resolve(cwd, envFile);
		if (existsSync(envPath)) {
			dotenvConfig({ path: envPath, override: true, quiet: true });
			loaded.push(envFile);
		} else if (envConfig) {
			// Only report as missing if explicitly configured
			missing.push(envFile);
		}
	}

	return { loaded, missing };
}

// ---------------------------------------------------------------------------
// Port utilities
// ---------------------------------------------------------------------------

/**
 * Check if a port is available
 * @internal Exported for testing
 */
export async function isPortAvailable(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();

		server.once('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				resolve(false);
			} else {
				resolve(false);
			}
		});

		server.once('listening', () => {
			server.close();
			resolve(true);
		});

		server.listen(port);
	});
}

/**
 * Find an available port starting from the preferred port
 * @internal Exported for testing
 */
export async function findAvailablePort(
	preferredPort: number,
	maxAttempts = 10,
): Promise<number> {
	for (let i = 0; i < maxAttempts; i++) {
		const port = preferredPort + i;
		if (await isPortAvailable(port)) {
			return port;
		}
		logger.log(`⚠️  Port ${port} is in use, trying ${port + 1}...`);
	}

	throw new Error(
		`Could not find an available port after trying ${maxAttempts} ports starting from ${preferredPort}`,
	);
}

// ---------------------------------------------------------------------------
// Docker Compose port mapping
// ---------------------------------------------------------------------------

/** Port state persisted to .gkm/ports.json, keyed by env var name. */
export type PortState = Record<string, number>;

const PORT_STATE_PATH = '.gkm/ports.json';

/**
 * Load saved port state from .gkm/ports.json.
 * @internal Exported for testing
 */
export async function loadPortState(workspaceRoot: string): Promise<PortState> {
	try {
		const raw = await readFile(join(workspaceRoot, PORT_STATE_PATH), 'utf-8');
		return JSON.parse(raw) as PortState;
	} catch {
		return {};
	}
}

/**
 * Save port state to .gkm/ports.json.
 * @internal Exported for testing
 */
export async function savePortState(
	workspaceRoot: string,
	ports: PortState,
): Promise<void> {
	const dir = join(workspaceRoot, '.gkm');
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(workspaceRoot, PORT_STATE_PATH),
		`${JSON.stringify(ports, null, 2)}\n`,
	);
}

// ---------------------------------------------------------------------------
// URL rewriting
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Docker Compose services
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Secrets loading
// ---------------------------------------------------------------------------

/**
 * Load and flatten secrets for an app from encrypted storage.
 * For workspace app: maps {APP}_DATABASE_URL → DATABASE_URL.
 * @internal Exported for testing
 */
export async function loadSecretsForApp(
	secretsRoot: string,
	stage: string,
	appName?: string,
): Promise<Record<string, string>> {
	let secrets: Record<string, string> = {};

	if (secretsExist(stage, secretsRoot)) {
		const stageSecrets = await readStageSecrets(stage, secretsRoot);
		if (stageSecrets) {
			logger.log(`🔐 Loading secrets from stage: ${stage}`);
			secrets = toEmbeddableSecrets(stageSecrets);
		}
	}

	if (Object.keys(secrets).length === 0) {
		return {};
	}

	// Single app mode - no mapping needed
	if (!appName) {
		return secrets;
	}

	// Workspace app mode - map {APP}_* to generic names
	const prefix = appName.toUpperCase();
	const mapped = { ...secrets };

	// Map {APP}_DATABASE_URL → DATABASE_URL
	const appDbUrl = secrets[`${prefix}_DATABASE_URL`];
	if (appDbUrl) {
		mapped.DATABASE_URL = appDbUrl;
	}

	return mapped;
}

/**
 * Walk up the directory tree to find the root containing .gkm/secrets/.
 * @internal Exported for testing
 */
export function findSecretsRoot(startDir: string): string {
	let dir = startDir;
	while (dir !== '/') {
		if (existsSync(join(dir, '.gkm', 'secrets'))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return startDir;
}

// ---------------------------------------------------------------------------
// Credentials preload / injection
// ---------------------------------------------------------------------------

/**
 * Generate the credentials injection code snippet.
 * This is the common logic used by both entry wrapper and exec preload.
 * @internal
 */
function generateCredentialsInjection(secretsJsonPath: string): string {
	return `import { existsSync, readFileSync } from 'node:fs';

// Inject dev secrets via globalThis and process.env
// Using globalThis.__gkm_credentials__ avoids CJS/ESM interop issues where
// Object.assign on the Credentials export only mutates one module copy.
const secretsPath = '${secretsJsonPath}';
if (existsSync(secretsPath)) {
  const secrets = JSON.parse(readFileSync(secretsPath, 'utf-8'));
  globalThis.__gkm_credentials__ = secrets;
  Object.assign(process.env, secrets);
}
`;
}

/**
 * Create a preload script that injects secrets into Credentials.
 * Used by `gkm exec` to inject secrets before running any command.
 * @internal Exported for testing
 */
export async function createCredentialsPreload(
	preloadPath: string,
	secretsJsonPath: string,
): Promise<void> {
	const content = `/**
 * Credentials preload generated by 'gkm exec'
 * This file is loaded via NODE_OPTIONS="--import <path>"
 */
${generateCredentialsInjection(secretsJsonPath)}`;

	await writeFile(preloadPath, content);
}

/**
 * Create a wrapper script that injects secrets before importing the entry file.
 * @internal Exported for testing
 */
export async function createEntryWrapper(
	wrapperPath: string,
	entryPath: string,
	secretsJsonPath?: string,
): Promise<void> {
	const credentialsInjection = secretsJsonPath
		? `${generateCredentialsInjection(secretsJsonPath)}
`
		: '';

	// Use dynamic import() to ensure secrets are assigned before the entry file loads
	// Static imports are hoisted, so Object.assign would run after the entry file is loaded
	const content = `#!/usr/bin/env node
/**
 * Entry wrapper generated by 'gkm dev --entry'
 */
${credentialsInjection}// Import and run the user's entry file (dynamic import ensures secrets load first)
await import('${entryPath}');
`;

	await writeFile(wrapperPath, content);
}

// ---------------------------------------------------------------------------
// Prepare credentials (shared by dev, exec, test)
// ---------------------------------------------------------------------------

/**
 * Result of preparing credentials.
 */
export interface EntryCredentialsResult {
	/** Credentials to inject (secrets + PORT) */
	credentials: Record<string, string>;
	/** Resolved port (from --port, workspace config, or default 3000) */
	resolvedPort: number;
	/** Path where credentials JSON was written */
	secretsJsonPath: string;
	/** Resolved app name (if in workspace) */
	appName: string | undefined;
	/** Secrets root directory */
	secretsRoot: string;
	/** Workspace app info (if in a workspace) */
	appInfo?: WorkspaceAppInfo;
	/**
	 * The keys the manifest declared, as opposed to those a secret store held.
	 *
	 * Kept apart because they cannot be *sniffed*. A construct reads its own key
	 * inside `@geekmidas/constructs`, not in application code, so a walk of the
	 * app finds no `get('MAIL_URL')` to find — and a caller that filters the
	 * environment down to what it sniffed would drop every URL the target just
	 * resolved. `gkm test` did exactly that.
	 */
	declaredKeys: string[];
}

/**
 * Prepare credentials for dev/exec/test modes.
 * Loads workspace config, secrets, resolves Docker ports, rewrites URLs,
 * injects PORT, dependency URLs, and writes credentials JSON.
 *
 * @param options.stage - The stage whose secrets to load. Default: the project's `stages.local`.
 * @param options.startDocker - Start Docker Compose services after port resolution. Default: false.
 * @param options.secretsFileName - Custom secrets JSON filename. Default: 'dev-secrets-{appName}.json' or 'dev-secrets.json'.
 * @internal Exported for testing
 */
export async function prepareEntryCredentials(options: {
	explicitPort?: number;
	cwd?: string;
	/** The stage whose secrets to load. Default: the project's `stages.local` */
	stage?: string;
	/** Start Docker Compose services after port resolution. Default: false */
	startDocker?: boolean;
	/** Custom secrets JSON filename. Default: 'dev-secrets-{appName}.json' or 'dev-secrets.json' */
	secretsFileName?: string;
	/**
	 * The stage to reconcile the local target for.
	 *
	 * `gkm test` passes `test` and gets the same containers with suffixed
	 * resources; left out, it is the project's local stage and they are
	 * unsuffixed. Only read by workspaces that have adopted the constructs glob.
	 */
	reconcileStage?: string;
}): Promise<EntryCredentialsResult> {
	const cwd = options.cwd ?? process.cwd();

	// Try to get workspace app config for port and secrets
	let workspaceAppPort: number | undefined;
	let secretsRoot: string = cwd;
	let appName: string | undefined;
	let appInfo: WorkspaceAppInfo | undefined;

	let workspace: NormalizedWorkspace | undefined;

	try {
		appInfo = await loadWorkspaceAppInfo(cwd);
		workspace = appInfo.workspace;
		workspaceAppPort = appInfo.app.port;
		secretsRoot = appInfo.workspaceRoot;
		appName = appInfo.appName;
	} catch {
		// Not an app — but possibly the workspace root, which is where the
		// scaffold's own `pnpm test` runs `gkm test` from. Without the workspace
		// here that run skipped the reconcile below: no container started, and the
		// URLs were whatever the stored secrets said, on ports nothing listened on.
		workspace = await loadWorkspaceConfig(cwd)
			.then((loaded) => loaded.workspace)
			.catch(() => undefined);
		// Otherwise not in a workspace at all (expected for non-gkm apps using
		// gkm exec) — use defaults.
		secretsRoot = workspace?.root ?? findSecretsRoot(cwd);
		appName = getAppNameFromCwd(cwd) ?? undefined;
	}

	// Determine port: explicit --port > workspace config > default 3000
	const resolvedPort = options.explicitPort ?? workspaceAppPort ?? 3000;

	// Load secrets and inject PORT. Outside a workspace there are no declared
	// stages to read, so only a stage asked for by name is loaded.
	const stage = options.stage ?? workspace?.stages.local;
	const credentials = stage
		? await loadSecretsForApp(secretsRoot, stage, appName)
		: {};

	// Always inject PORT into credentials so apps can read it
	credentials.PORT = String(resolvedPort);
	// Expo reads its Metro port from here when `expo start` is given none, so
	// a mobile app runs where the workspace placed it — and where the `exp://`
	// origins its auth server trusts say it is.
	if (appInfo?.app.type === 'mobile') {
		credentials.RCT_METRO_PORT = String(resolvedPort);
	}

	const declaredKeys: string[] = [];

	// Every address — containers, the edge, each app — comes from what the
	// workspace declares. Outside a workspace (a non-gkm app using `gkm exec`)
	// there is nothing to resolve, only the secrets above.
	if (workspace) {
		const { reconcileWorkspace } = await import('../reconcile/workspace.js');
		const reconciled = await reconcileWorkspace(workspace, {
			stage: options.reconcileStage ?? workspace.stages.local,
			start: options.startDocker ?? false,
		});

		// Declared URLs win over anything stored: the manifest is the statement
		// of what exists, and a stale secret naming an old port is exactly the
		// drift this replaces.
		Object.assign(credentials, reconciled.env);
		declaredKeys.push(...Object.keys(reconciled.env));

		if (Object.keys(reconciled.env).length > 0) {
			logger.log(
				`🔌 Resolved ${Object.keys(reconciled.env).length} declared URL(s)`,
			);
		}
	}

	// Write secrets to temp JSON file (always write since we have PORT)
	// Use app-specific filename to avoid race conditions when running multiple apps via turbo
	const secretsDir = join(secretsRoot, '.gkm');
	await mkdir(secretsDir, { recursive: true });
	const secretsFileName =
		options.secretsFileName ??
		(appName ? `dev-secrets-${appName}.json` : 'dev-secrets.json');
	const secretsJsonPath = join(secretsDir, secretsFileName);
	await writeFile(secretsJsonPath, JSON.stringify(credentials, null, 2));

	return {
		credentials,
		resolvedPort,
		secretsJsonPath,
		appName,
		secretsRoot,
		appInfo,
		declaredKeys,
	};
}
