import { basename } from 'node:path';
import type { GkmConfig } from '../types.js';
import { getPublicEnvPrefix } from './publicEnv.js';
import {
	formatValidationErrors,
	safeValidateWorkspaceConfig,
} from './schema.js';
import type {
	AppConfig,
	AppsRecord,
	DeployTarget,
	InferredWorkspaceConfig,
	LoadedConfig,
	NormalizedAppConfig,
	NormalizedWorkspace,
	WorkspaceConfig,
	WorkspaceInput,
} from './types.js';
import { isWorkspaceConfig } from './types.js';

export {
	getPublicEnvPrefix,
	PUBLIC_ENV_PREFIXES,
	stripPublicPrefix,
} from './publicEnv.js';
export {
	formatValidationErrors,
	getDeployTargetError,
	isDeployTargetSupported,
	isPhase2DeployTarget,
	PHASE_2_DEPLOY_TARGETS,
	SUPPORTED_DEPLOY_TARGETS,
	safeValidateWorkspaceConfig,
	validateWorkspaceConfig,
	WorkspaceConfigSchema,
} from './schema.js';
// Re-export types
export type {
	AppConfig,
	AppConfigInput,
	AppInput,
	AppsRecord,
	BackendFramework,
	ConstrainedApps,
	DeployConfig,
	DeployTarget,
	DokployWorkspaceConfig,
	FrontendFramework,
	InferAppNames,
	InferredWorkspaceConfig,
	LoadedConfig,
	MailServiceConfig,
	ModelsConfig,
	NormalizedAppConfig,
	NormalizedWorkspace,
	SecretsConfig,
	ServiceImageConfig,
	ServicesConfig,
	SharedConfig,
	WorkspaceConfig,
	WorkspaceInput,
} from './types.js';
export { isWorkspaceConfig } from './types.js';

/**
 * Validate that all dependencies reference existing apps.
 * Returns the config if valid, throws otherwise.
 */
function validateDependencies<TApps extends AppsRecord>(apps: TApps): void {
	const appNames = new Set(Object.keys(apps));

	for (const [appName, app] of Object.entries(apps)) {
		for (const dep of app.dependencies ?? []) {
			if (!appNames.has(dep)) {
				throw new Error(
					`Invalid dependency: App "${appName}" depends on "${dep}" which does not exist. ` +
						`Valid apps are: ${[...appNames].join(', ')}`,
				);
			}
			if (dep === appName) {
				throw new Error(
					`Invalid dependency: App "${appName}" cannot depend on itself.`,
				);
			}
		}
	}
}

/**
 * Define workspace configuration with full TypeScript support and type inference.
 *
 * Uses `const` type parameter to infer literal app names, providing:
 * - Autocomplete for app names in dependencies
 * - Type errors for invalid dependency references
 * - Full type inference for the returned config
 *
 * @example
 * ```ts
 * // gkm.config.ts
 * import { defineWorkspace } from '@geekmidas/cli';
 *
 * export default defineWorkspace({
 *   name: 'my-saas',
 *   apps: {
 *     api: {
 *       type: 'backend',
 *       path: 'apps/api',
 *       port: 3000,
 *       routes: './src/endpoints/**\/*.ts',
 *       envParser: './src/config/env',
 *       logger: './src/logger',
 *     },
 *     web: {
 *       type: 'web',
 *       framework: 'nextjs',
 *       path: 'apps/web',
 *       port: 3001,
 *       dependencies: ['api'], // <- autocomplete shows 'api' | 'web'
 *     },
 *   },
 *   services: {
 *     db: true,
 *     cache: true,
 *   },
 * });
 *
 * // config.apps.api <- full type inference
 * // config.apps.foo <- TypeScript error
 * ```
 */
export function defineWorkspace<const TApps extends AppsRecord>(
	config: WorkspaceInput<TApps>,
): InferredWorkspaceConfig<TApps> {
	// Validate dependencies at runtime
	validateDependencies(config.apps as unknown as TApps);

	// Validate with Zod schema
	const result = safeValidateWorkspaceConfig(config);
	if (!result.success && result.error) {
		throw new Error(formatValidationErrors(result.error));
	}

	return config as unknown as InferredWorkspaceConfig<TApps>;
}

/**
 * Get the package name from package.json in the given directory.
 */
function getPackageName(cwd: string): string | undefined {
	try {
		// Dynamic import would be async, so we use require for sync operation
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const pkg = require(`${cwd}/package.json`);
		return pkg.name?.replace(/^@[^/]+\//, ''); // Remove scope
	} catch {
		return undefined;
	}
}

/**
 * Normalize a workspace configuration with resolved defaults.
 */
export function normalizeWorkspace(
	config: WorkspaceConfig,
	cwd: string,
): NormalizedWorkspace {
	const name = config.name ?? getPackageName(cwd) ?? basename(cwd);
	const defaultTarget = config.deploy?.default ?? 'dokploy';

	const normalizedApps: Record<string, NormalizedAppConfig> = {};

	for (const [appName, app] of Object.entries(config.apps)) {
		normalizedApps[appName] = normalizeAppConfig(app, defaultTarget);
	}

	return {
		name,
		root: cwd,
		apps: normalizedApps,
		services: config.services ?? {},
		deploy: config.deploy ?? { default: 'dokploy' },
		shared: config.shared ?? { packages: ['packages/*'] },
		secrets: config.secrets ?? {},
		state: config.state,
	};
}

/**
 * Normalize an app configuration with resolved defaults.
 * @param app - App configuration
 * @param defaultTarget - Default deploy target from workspace config
 */
function normalizeAppConfig(
	app: AppConfig,
	defaultTarget: DeployTarget,
): NormalizedAppConfig {
	return {
		...app,
		type: app.type ?? 'backend',
		port: app.port,
		path: app.path,
		dependencies: app.dependencies ?? [],
		resolvedDeployTarget: app.deploy ?? defaultTarget,
	};
}

/**
 * Wrap a single-app GkmConfig as a workspace.
 * This allows existing single-app configs to work seamlessly.
 */
export function wrapSingleAppAsWorkspace(
	config: GkmConfig,
	cwd: string,
): NormalizedWorkspace {
	// `config.name` first, the way `defineWorkspace` already reads it. It was
	// only honoured on the workspace path, so the same field decided the scope
	// in a monorepo and was ignored in a single-app project.
	const name = config.name ?? getPackageName(cwd) ?? basename(cwd);

	// `docker.compose.services` no longer decides anything here.
	//
	// It used to seed `services.db` and `services.cache`, which is to say a
	// container existed because a compose list named it. Which containers exist
	// is the manifest's answer now — a database implies Postgres, a declared
	// cache implies whichever container its backend needs — so the compose block
	// is left to be what its name says: a deploy-side list.
	const normalizedServices: NormalizedWorkspace['services'] = {
		...(config.services ?? {}),
	};

	const apiApp: NormalizedAppConfig = {
		type: 'backend',
		path: '.',
		port: 3000,
		dependencies: [],
		resolvedDeployTarget: 'dokploy',
		constructs: config.constructs,
		routes: config.routes,
		functions: config.functions,
		crons: config.crons,
		queues: config.queues,
		topics: config.topics,
		subscribers: config.subscribers,
		envParser: config.envParser,
		logger: config.logger,
		providers: config.providers,
		hooks: config.hooks,
		telescope: config.telescope,
		studio: config.studio,
		openapi: config.openapi,
		runtime: config.runtime,
		env: config.env,
	};

	return {
		name,
		root: cwd,
		apps: { api: apiApp },
		services: normalizedServices,
		// Carried rather than replaced. A single-app project configures its
		// deploy in the same shape a workspace does — endpoint, registry,
		// domains — and hardcoding the default here silently discarded all of it,
		// which surfaced as `resolveHost` refusing to name a host for a stage the
		// config had no way to describe.
		deploy: { default: 'dokploy', ...config.deploy },
		shared: { packages: [] },
		secrets: {},
	};
}

/**
 * Process a loaded configuration (either single-app or workspace).
 * Returns a normalized workspace in both cases.
 */
export function processConfig(
	config: GkmConfig | WorkspaceConfig,
	cwd: string,
): LoadedConfig {
	if (isWorkspaceConfig(config)) {
		// Validate workspace config
		const result = safeValidateWorkspaceConfig(config);
		if (!result.success && result.error) {
			throw new Error(formatValidationErrors(result.error));
		}

		return {
			type: 'workspace',
			raw: config,
			workspace: normalizeWorkspace(config, cwd),
		};
	}

	// Single-app config - wrap as workspace
	return {
		type: 'single',
		raw: config,
		workspace: wrapSingleAppAsWorkspace(config, cwd),
	};
}

/**
 * Get the GkmConfig for a specific app in a workspace.
 * Useful for running existing single-app commands on a specific app.
 */
export function getAppGkmConfig(
	workspace: NormalizedWorkspace,
	appName: string,
): GkmConfig | undefined {
	const app = workspace.apps[appName];
	if (!app || app.type !== 'backend') {
		return undefined;
	}

	return {
		// Workspace-level, and carried here deliberately. These name the backends
		// a cache and a mailer resolve to, which the *entry point* reads when it
		// decides which drivers to register — and the local target reads from the
		// workspace when it composes the URLs those drivers receive. Dropping the
		// field left the two reading different answers: a project on
		// `cache: 'db'` was handed a `postgres://` URL by an entry that had
		// registered only the Upstash driver, and every request failed with
		// `UnregisteredCacheScheme`.
		services: workspace.services,
		constructs: app.constructs,
		routes: app.routes ?? '',
		functions: app.functions,
		crons: app.crons,
		queues: app.queues,
		topics: app.topics,
		subscribers: app.subscribers,
		envParser: app.envParser ?? '',
		logger: app.logger ?? '',
		providers: app.providers,
		hooks: app.hooks,
		telescope: app.telescope,
		studio: app.studio,
		openapi: app.openapi,
		runtime: app.runtime,
		env: app.env,
	};
}

/**
 * Get topologically sorted app names based on dependencies.
 * Apps with no dependencies come first, then apps that depend on them.
 */
export function getAppBuildOrder(workspace: NormalizedWorkspace): string[] {
	const appNames = Object.keys(workspace.apps);
	const visited = new Set<string>();
	const result: string[] = [];

	function visit(name: string) {
		if (visited.has(name)) return;
		visited.add(name);

		const app = workspace.apps[name];
		if (app) {
			for (const dep of app.dependencies) {
				visit(dep);
			}
		}

		result.push(name);
	}

	for (const name of appNames) {
		visit(name);
	}

	return result;
}

/**
 * Generate environment variables for app dependencies.
 *
 * Each dependency gets the un-prefixed `{DEP}_URL` (for server-side use) and,
 * when the consuming app's framework supports a public-var prefix, also the
 * prefixed form (e.g. `NEXT_PUBLIC_{DEP}_URL` for Next.js, `VITE_{DEP}_URL`
 * for Vite/TanStack Start). The prefixed form is what gets bundled into the
 * client at build time.
 */
export function getDependencyEnvVars(
	workspace: NormalizedWorkspace,
	appName: string,
	urlPrefix = 'http://localhost',
): Record<string, string> {
	const app = workspace.apps[appName];
	if (!app) return {};

	const env: Record<string, string> = {};
	const publicPrefix = getPublicEnvPrefix(app.framework);

	for (const depName of app.dependencies) {
		const dep = workspace.apps[depName];
		if (dep) {
			const url = `${urlPrefix}:${dep.port}`;
			const envKey = `${depName.toUpperCase()}_URL`;
			env[envKey] = url;
			if (publicPrefix) {
				env[`${publicPrefix}${envKey}`] = url;
			}
		}
	}

	return env;
}

/**
 * Resolve the Dokploy endpoint for a specific stage.
 *
 * Uses per-stage endpoint from `endpoints` if available,
 * otherwise falls back to the global `endpoint`.
 *
 * @param dokployConfig - Dokploy workspace configuration
 * @param stage - Deployment stage (e.g., 'development', 'production')
 * @returns The endpoint URL for the stage, or undefined if not configured
 *
 * @example
 * ```ts
 * // With per-stage endpoints
 * const config = {
 *   endpoints: {
 *     development: 'https://dev.dokploy.example.com:3000',
 *     production: 'https://prod.dokploy.example.com:3000',
 *   },
 * };
 * getEndpointForStage(config, 'production'); // => 'https://prod.dokploy.example.com:3000'
 *
 * // With single endpoint
 * const config = { endpoint: 'https://dokploy.example.com:3000' };
 * getEndpointForStage(config, 'production'); // => 'https://dokploy.example.com:3000'
 * ```
 */
export function getEndpointForStage(
	dokployConfig:
		| { endpoint?: string; endpoints?: Record<string, string> }
		| undefined,
	stage: string,
): string | undefined {
	if (!dokployConfig) return undefined;

	// Check per-stage endpoint first
	if (dokployConfig.endpoints?.[stage]) {
		return dokployConfig.endpoints[stage];
	}

	// Fall back to global endpoint
	return dokployConfig.endpoint;
}
