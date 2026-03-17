import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { parse as parseYaml } from 'yaml';
import {
	getAppNameFromCwd,
	loadWorkspaceAppInfo,
	type WorkspaceAppInfo,
} from '../config';
import {
	readStageSecrets,
	secretsExist,
	toEmbeddableSecrets,
} from '../secrets/storage.js';
import { getDependencyEnvVars } from '../workspace/index.js';

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

/**
 * A port mapping extracted from docker-compose.yml.
 * Only entries using env var interpolation (e.g., `${VAR:-default}:container`) are captured.
 */
export interface ComposePortMapping {
	service: string;
	envVar: string;
	defaultPort: number;
	containerPort: number;
}

/** Port state persisted to .gkm/ports.json, keyed by env var name. */
export type PortState = Record<string, number>;

export interface ResolvedServicePorts {
	dockerEnv: Record<string, string>;
	ports: PortState;
	mappings: ComposePortMapping[];
}

const PORT_STATE_PATH = '.gkm/ports.json';

/**
 * Parse docker-compose.yml and extract all port mappings that use env var interpolation.
 * Entries like `'${POSTGRES_HOST_PORT:-5432}:5432'` are captured.
 * Fixed port mappings like `'5050:80'` are skipped.
 * @internal Exported for testing
 */
export function parseComposePortMappings(
	composePath: string,
): ComposePortMapping[] {
	if (!existsSync(composePath)) {
		return [];
	}

	const content = readFileSync(composePath, 'utf-8');
	const compose = parseYaml(content) as {
		services?: Record<string, { ports?: string[] }>;
	};

	if (!compose?.services) {
		return [];
	}

	const results: ComposePortMapping[] = [];

	for (const [serviceName, serviceConfig] of Object.entries(compose.services)) {
		for (const portMapping of serviceConfig?.ports ?? []) {
			const match = String(portMapping).match(/\$\{(\w+):-(\d+)\}:(\d+)/);
			if (match?.[1] && match[2] && match[3]) {
				results.push({
					service: serviceName,
					envVar: match[1],
					defaultPort: Number(match[2]),
					containerPort: Number(match[3]),
				});
			}
		}
	}

	return results;
}

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

/**
 * Check if a project's own Docker container is running and return its host port.
 * Uses `docker compose port` scoped to the project's compose file.
 * @internal Exported for testing
 */
export function getContainerHostPort(
	workspaceRoot: string,
	service: string,
	containerPort: number,
): number | null {
	try {
		const result = execSync(`docker compose port ${service} ${containerPort}`, {
			cwd: workspaceRoot,
			stdio: 'pipe',
		})
			.toString()
			.trim();
		const match = result.match(/:(\d+)$/);
		return match ? Number(match[1]) : null;
	} catch {
		return null;
	}
}

/**
 * Resolve host ports for Docker services by parsing docker-compose.yml.
 * Priority: running container → saved state → find available port.
 * Persists resolved ports to .gkm/ports.json.
 * @internal Exported for testing
 */
export async function resolveServicePorts(
	workspaceRoot: string,
): Promise<ResolvedServicePorts> {
	const composePath = join(workspaceRoot, 'docker-compose.yml');
	const mappings = parseComposePortMappings(composePath);

	if (mappings.length === 0) {
		return { dockerEnv: {}, ports: {}, mappings: [] };
	}

	const savedState = await loadPortState(workspaceRoot);
	const dockerEnv: Record<string, string> = {};
	const ports: PortState = {};
	// Track ports assigned in this cycle to avoid duplicates
	const assignedPorts = new Set<number>();

	logger.log('\n🔌 Resolving service ports...');

	for (const mapping of mappings) {
		// 1. Check if own container is already running
		const containerPort = getContainerHostPort(
			workspaceRoot,
			mapping.service,
			mapping.containerPort,
		);
		if (containerPort !== null) {
			ports[mapping.envVar] = containerPort;
			dockerEnv[mapping.envVar] = String(containerPort);
			assignedPorts.add(containerPort);
			logger.log(
				`   🔄 ${mapping.service}:${mapping.containerPort}: reusing existing container on port ${containerPort}`,
			);
			continue;
		}

		// 2. Check saved port state
		const savedPort = savedState[mapping.envVar];
		if (
			savedPort &&
			!assignedPorts.has(savedPort) &&
			(await isPortAvailable(savedPort))
		) {
			ports[mapping.envVar] = savedPort;
			dockerEnv[mapping.envVar] = String(savedPort);
			assignedPorts.add(savedPort);
			logger.log(
				`   💾 ${mapping.service}:${mapping.containerPort}: using saved port ${savedPort}`,
			);
			continue;
		}

		// 3. Find available port (skipping ports already assigned this cycle)
		let resolvedPort = await findAvailablePort(mapping.defaultPort);
		while (assignedPorts.has(resolvedPort)) {
			resolvedPort = await findAvailablePort(resolvedPort + 1);
		}
		ports[mapping.envVar] = resolvedPort;
		dockerEnv[mapping.envVar] = String(resolvedPort);
		assignedPorts.add(resolvedPort);

		if (resolvedPort !== mapping.defaultPort) {
			logger.log(
				`   ⚡ ${mapping.service}:${mapping.containerPort}: port ${mapping.defaultPort} occupied, using port ${resolvedPort}`,
			);
		} else {
			logger.log(
				`   ✅ ${mapping.service}:${mapping.containerPort}: using default port ${resolvedPort}`,
			);
		}
	}

	await savePortState(workspaceRoot, ports);

	return { dockerEnv, ports, mappings };
}

// ---------------------------------------------------------------------------
// URL rewriting
// ---------------------------------------------------------------------------

/**
 * Replace a port in a URL string.
 * Handles both `hostname:port` and `localhost:port` patterns.
 * @internal Exported for testing
 */
export function replacePortInUrl(
	url: string,
	oldPort: number,
	newPort: number,
): string {
	if (oldPort === newPort) return url;
	// Replace literal :port (in authority section)
	let result = url.replace(
		new RegExp(`:${oldPort}(?=[/?#]|$)`, 'g'),
		`:${newPort}`,
	);
	// Replace URL-encoded :port (e.g., in query params like endpoint=http%3A%2F%2Flocalhost%3A4566)
	result = result.replace(
		new RegExp(`%3A${oldPort}(?=[%/?#&]|$)`, 'gi'),
		`%3A${newPort}`,
	);
	return result;
}

/**
 * Rewrite connection URLs and port vars in secrets with resolved ports.
 * Uses the parsed compose mappings to determine which default ports to replace.
 * Pure transform — does not modify secrets on disk.
 * @internal Exported for testing
 */
export function rewriteUrlsWithPorts(
	secrets: Record<string, string>,
	resolvedPorts: ResolvedServicePorts,
): Record<string, string> {
	const { ports, mappings } = resolvedPorts;
	const result = { ...secrets };

	// Build a map of defaultPort → resolvedPort for all changed ports
	const portReplacements: { defaultPort: number; resolvedPort: number }[] = [];
	// Collect Docker service names for hostname rewriting
	const serviceNames = new Set<string>();
	for (const mapping of mappings) {
		serviceNames.add(mapping.service);
		const resolved = ports[mapping.envVar];
		if (resolved !== undefined) {
			portReplacements.push({
				defaultPort: mapping.defaultPort,
				resolvedPort: resolved,
			});
		}
	}

	// Rewrite _HOST env vars that use Docker service names
	for (const [key, value] of Object.entries(result)) {
		if (!key.endsWith('_HOST')) continue;
		if (serviceNames.has(value)) {
			result[key] = 'localhost';
		}
	}

	// Rewrite _PORT env vars whose values match a default port
	for (const [key, value] of Object.entries(result)) {
		if (!key.endsWith('_PORT')) continue;
		for (const { defaultPort, resolvedPort } of portReplacements) {
			if (value === String(defaultPort)) {
				result[key] = String(resolvedPort);
			}
		}
	}

	// Rewrite URLs: replace Docker service hostnames with localhost and fix ports
	for (const [key, value] of Object.entries(result)) {
		if (
			!key.endsWith('_URL') &&
			!key.endsWith('_ENDPOINT') &&
			!key.endsWith('_CONNECTION_STRING') &&
			key !== 'DATABASE_URL'
		)
			continue;

		let rewritten = value;
		for (const name of serviceNames) {
			rewritten = rewritten.replace(
				new RegExp(`@${name}:`, 'g'),
				'@localhost:',
			);
		}
		for (const { defaultPort, resolvedPort } of portReplacements) {
			rewritten = replacePortInUrl(rewritten, defaultPort, resolvedPort);
		}
		result[key] = rewritten;
	}

	return result;
}

// ---------------------------------------------------------------------------
// Docker Compose services
// ---------------------------------------------------------------------------

/**
 * Build the environment variables to pass to `docker compose up`.
 * Merges process.env, secrets, and port mappings so that Docker Compose
 * can interpolate variables like ${POSTGRES_USER} correctly.
 * @internal Exported for testing
 */
export function buildDockerComposeEnv(
	secretsEnv?: Record<string, string>,
	portEnv?: Record<string, string>,
): Record<string, string | undefined> {
	return { ...process.env, ...secretsEnv, ...portEnv };
}

/**
 * Parse all service names from a docker-compose.yml file.
 * @internal Exported for testing
 */
export function parseComposeServiceNames(composePath: string): string[] {
	if (!existsSync(composePath)) {
		return [];
	}

	const content = readFileSync(composePath, 'utf-8');
	const compose = parseYaml(content) as {
		services?: Record<string, unknown>;
	};

	return Object.keys(compose?.services ?? {});
}

/**
 * Start docker-compose services for a single-app project (no workspace config).
 * Starts all services defined in docker-compose.yml.
 */
export async function startComposeServices(
	cwd: string,
	portEnv?: Record<string, string>,
	secretsEnv?: Record<string, string>,
): Promise<void> {
	const composeFile = join(cwd, 'docker-compose.yml');
	if (!existsSync(composeFile)) {
		return;
	}

	const servicesToStart = parseComposeServiceNames(composeFile);
	if (servicesToStart.length === 0) {
		return;
	}

	logger.log(`🐳 Starting services: ${servicesToStart.join(', ')}`);

	try {
		execSync(`docker compose up -d ${servicesToStart.join(' ')}`, {
			cwd,
			stdio: 'inherit',
			env: buildDockerComposeEnv(secretsEnv, portEnv),
		});

		logger.log('✅ Services started');
	} catch (error) {
		logger.error('❌ Failed to start services:', (error as Error).message);
		throw error;
	}
}

/**
 * Start docker-compose services for a workspace.
 * Discovers all services from docker-compose.yml and starts everything
 * except app services (which are managed by turbo).
 * @internal Exported for testing
 */
export async function startWorkspaceServices(
	workspace: { root: string; apps: Record<string, unknown> },
	portEnv?: Record<string, string>,
	secretsEnv?: Record<string, string>,
): Promise<void> {
	const composeFile = join(workspace.root, 'docker-compose.yml');
	if (!existsSync(composeFile)) {
		return;
	}

	// Discover all services from docker-compose.yml
	const allServices = parseComposeServiceNames(composeFile);

	// Exclude app services (managed by turbo, not docker)
	const appNames = new Set(Object.keys(workspace.apps));
	const servicesToStart = allServices.filter((name) => !appNames.has(name));

	if (servicesToStart.length === 0) {
		return;
	}

	logger.log(`🐳 Starting services: ${servicesToStart.join(', ')}`);

	try {
		// Start services with docker-compose, passing secrets so that
		// POSTGRES_USER, POSTGRES_PASSWORD, etc. are interpolated correctly
		execSync(`docker compose up -d ${servicesToStart.join(' ')}`, {
			cwd: workspace.root,
			stdio: 'inherit',
			env: buildDockerComposeEnv(secretsEnv, portEnv),
		});

		logger.log('✅ Services started');
	} catch (error) {
		logger.error('❌ Failed to start services:', (error as Error).message);
		throw error;
	}
}

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
	appName?: string,
	stages: string[] = ['dev', 'development'],
): Promise<Record<string, string>> {
	let secrets: Record<string, string> = {};

	for (const stage of stages) {
		if (secretsExist(stage, secretsRoot)) {
			const stageSecrets = await readStageSecrets(stage, secretsRoot);
			if (stageSecrets) {
				logger.log(`🔐 Loading secrets from stage: ${stage}`);
				secrets = toEmbeddableSecrets(stageSecrets);
				break;
			}
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
}

/**
 * Prepare credentials for dev/exec/test modes.
 * Loads workspace config, secrets, resolves Docker ports, rewrites URLs,
 * injects PORT, dependency URLs, and writes credentials JSON.
 *
 * @param options.resolveDockerPorts - How to resolve Docker ports:
 *   - `'full'` (default): probe running containers, saved state, then find available ports. Used by dev/test.
 *   - `'readonly'`: check running containers and saved state only, never probe for new ports. Used by exec.
 * @param options.stages - Secret stages to try, in order. Default: ['dev', 'development'].
 * @param options.startDocker - Start Docker Compose services after port resolution. Default: false.
 * @param options.secretsFileName - Custom secrets JSON filename. Default: 'dev-secrets-{appName}.json' or 'dev-secrets.json'.
 * @internal Exported for testing
 */
export async function prepareEntryCredentials(options: {
	explicitPort?: number;
	cwd?: string;
	resolveDockerPorts?: 'full' | 'readonly';
	/** Secret stages to try, in order. Default: ['dev', 'development'] */
	stages?: string[];
	/** Start Docker Compose services after port resolution. Default: false */
	startDocker?: boolean;
	/** Custom secrets JSON filename. Default: 'dev-secrets-{appName}.json' or 'dev-secrets.json' */
	secretsFileName?: string;
}): Promise<EntryCredentialsResult> {
	const cwd = options.cwd ?? process.cwd();
	const portMode = options.resolveDockerPorts ?? 'full';

	// Try to get workspace app config for port and secrets
	let workspaceAppPort: number | undefined;
	let secretsRoot: string = cwd;
	let appName: string | undefined;
	let appInfo: WorkspaceAppInfo | undefined;

	try {
		appInfo = await loadWorkspaceAppInfo(cwd);
		workspaceAppPort = appInfo.app.port;
		secretsRoot = appInfo.workspaceRoot;
		appName = appInfo.appName;
	} catch {
		// Not in a workspace - use defaults (expected for non-gkm apps using gkm exec)
		secretsRoot = findSecretsRoot(cwd);
		appName = getAppNameFromCwd(cwd) ?? undefined;
	}

	// Determine port: explicit --port > workspace config > default 3000
	const resolvedPort = options.explicitPort ?? workspaceAppPort ?? 3000;

	// Load secrets and inject PORT
	const credentials = await loadSecretsForApp(
		secretsRoot,
		appName,
		options.stages,
	);

	// Always inject PORT into credentials so apps can read it
	credentials.PORT = String(resolvedPort);

	// Resolve Docker ports and rewrite connection URLs
	const composePath = join(secretsRoot, 'docker-compose.yml');
	const mappings = parseComposePortMappings(composePath);
	if (mappings.length > 0) {
		let resolvedPorts: ResolvedServicePorts;

		if (portMode === 'full') {
			// Full resolution: probe containers, saved state, find available ports
			resolvedPorts = await resolveServicePorts(secretsRoot);
		} else {
			// Readonly: check running containers and saved state only
			const savedPorts = await loadPortState(secretsRoot);
			const ports: PortState = {};

			for (const mapping of mappings) {
				const containerPort = getContainerHostPort(
					secretsRoot,
					mapping.service,
					mapping.containerPort,
				);
				if (containerPort !== null) {
					ports[mapping.envVar] = containerPort;
				} else {
					const saved = savedPorts[mapping.envVar];
					if (saved !== undefined) {
						ports[mapping.envVar] = saved;
					}
				}
			}

			resolvedPorts = { dockerEnv: {}, ports, mappings };
		}

		// Start Docker services if requested (between port resolution and URL rewriting)
		// Docker needs raw secrets (POSTGRES_USER, etc.) + resolved port env for compose interpolation
		if (options.startDocker) {
			if (appInfo) {
				await startWorkspaceServices(
					appInfo.workspace,
					resolvedPorts.dockerEnv,
					credentials,
				);
			} else {
				await startComposeServices(
					secretsRoot,
					resolvedPorts.dockerEnv,
					credentials,
				);
			}
		}

		if (Object.keys(resolvedPorts.ports).length > 0) {
			const rewritten = rewriteUrlsWithPorts(credentials, resolvedPorts);
			Object.assign(credentials, rewritten);
			logger.log(
				`🔌 Applied ${Object.keys(resolvedPorts.ports).length} port mapping(s)`,
			);
		}
	}

	// Inject dependency URLs (works for both frontend and backend apps)
	if (appInfo?.appName) {
		const depEnv = getDependencyEnvVars(appInfo.workspace, appInfo.appName);
		Object.assign(credentials, depEnv);
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
	};
}
