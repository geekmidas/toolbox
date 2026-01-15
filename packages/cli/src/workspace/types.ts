import type {
	GkmConfig,
	HooksConfig,
	OpenApiConfig,
	ProvidersConfig,
	Routes,
	Runtime,
	StudioConfig,
	TelescopeConfig,
} from '../types.js';

/**
 * Deploy target for an app.
 * Currently only 'dokploy' is supported.
 * Future: 'vercel' | 'cloudflare'
 */
export type DeployTarget = 'dokploy' | 'vercel' | 'cloudflare';

/**
 * Backend framework types for apps that don't use gkm routes.
 */
export type BackendFramework = 'hono' | 'better-auth' | 'express' | 'fastify';

/**
 * Frontend framework types.
 */
export type FrontendFramework = 'nextjs' | 'remix' | 'vite';

/**
 * Service image configuration for custom Docker images.
 */
export interface ServiceImageConfig {
	/** Docker image version/tag (e.g., '18-alpine') */
	version?: string;
	/** Full Docker image reference (overrides version) */
	image?: string;
}

/**
 * Mail service configuration.
 */
export interface MailServiceConfig extends ServiceImageConfig {
	/** SMTP configuration for production */
	smtp?: {
		host: string;
		port: number;
		user?: string;
		pass?: string;
	};
}

/**
 * Development services configuration.
 */
export interface ServicesConfig {
	/** PostgreSQL database (default: postgres:18-alpine) */
	db?: boolean | ServiceImageConfig;
	/** Redis cache (default: redis:8-alpine) */
	cache?: boolean | ServiceImageConfig;
	/** Mail service (mailpit for dev) */
	mail?: boolean | MailServiceConfig;
}

/**
 * Dokploy workspace deployment configuration.
 */
export interface DokployWorkspaceConfig {
	/** Dokploy API endpoint */
	endpoint: string;
	/** Project ID (1 workspace = 1 project) */
	projectId: string;
	/** Container registry for images */
	registry?: string;
	/** Registry ID in Dokploy */
	registryId?: string;
}

/**
 * Deployment configuration for the workspace.
 */
export interface DeployConfig {
	/** Default deploy target for all apps */
	default?: DeployTarget;
	/** Dokploy-specific configuration */
	dokploy?: DokployWorkspaceConfig;
}

/**
 * Models package configuration for shared schemas.
 */
export interface ModelsConfig {
	/** Path to models package (default: packages/models) */
	path?: string;
	/**
	 * Schema library to use.
	 * Currently only 'zod' is supported.
	 * Future: any StandardSchema-compatible library
	 */
	schema?: 'zod';
}

/**
 * Shared packages configuration.
 */
export interface SharedConfig {
	/** Glob patterns for shared packages (default: ['packages/*']) */
	packages?: string[];
	/** Models package configuration */
	models?: ModelsConfig;
}

/**
 * Secrets encryption configuration.
 */
export interface SecretsConfig {
	/** Enable encrypted secrets */
	enabled?: boolean;
	/** Encryption algorithm (default: aes-256-gcm) */
	algorithm?: string;
	/** Key derivation function (default: scrypt) */
	kdf?: 'scrypt' | 'pbkdf2';
}

/**
 * Client generation configuration for frontend apps.
 */
export interface ClientConfig {
	/** Output directory for generated client (relative to app path) */
	output?: string;
}

/**
 * Base app configuration properties (shared between input and normalized).
 */
interface AppConfigBase {
	/** App type (default: 'backend') */
	type?: 'backend' | 'frontend';

	/** Path relative to workspace root */
	path: string;

	/** Dev server port */
	port: number;

	/** Per-app deploy target override */
	deploy?: DeployTarget;

	// Backend-specific (from GkmConfig)
	/** Routes glob pattern */
	routes?: Routes;
	/** Functions glob pattern */
	functions?: Routes;
	/** Crons glob pattern */
	crons?: Routes;
	/** Subscribers glob pattern */
	subscribers?: Routes;
	/** Path to environment parser module */
	envParser?: string;
	/** Path to logger module */
	logger?: string;
	/** Provider configuration */
	providers?: ProvidersConfig;
	/** Server lifecycle hooks */
	hooks?: HooksConfig;
	/** Telescope configuration */
	telescope?: string | boolean | TelescopeConfig;
	/** Studio configuration */
	studio?: string | boolean | StudioConfig;
	/** OpenAPI configuration */
	openapi?: boolean | OpenApiConfig;
	/** Runtime (node or bun) */
	runtime?: Runtime;
	/** Environment file(s) to load */
	env?: string | string[];

	// Entry point for non-gkm apps
	/**
	 * Entry file path for apps that don't use gkm routes.
	 * Used by both `gkm dev` (runs with tsx) and Docker builds (bundles with tsdown).
	 * @example './src/index.ts'
	 */
	entry?: string;

	// Frontend-specific
	/** Framework for the app (frontend or backend without gkm routes) */
	framework?: BackendFramework | FrontendFramework;
	/** Client generation configuration */
	client?: ClientConfig;
}

/**
 * App configuration input with type-safe dependencies.
 * @template TAppNames - Union of valid app names in the workspace
 */
export interface AppConfigInput<TAppNames extends string = string>
	extends AppConfigBase {
	/** Dependencies on other apps in the workspace (type-safe) */
	dependencies?: TAppNames[];
}

/**
 * App configuration (legacy, for backwards compatibility).
 * @deprecated Use AppConfigInput for new code
 */
export interface AppConfig extends AppConfigBase {
	/** Dependencies on other apps in the workspace */
	dependencies?: string[];
}

/**
 * Base app input type for type inference.
 */
export type AppInput = AppConfigBase & {
	dependencies?: readonly string[];
};

/**
 * Apps record type for workspace configuration.
 */
export type AppsRecord = Record<string, AppInput>;

/**
 * Constrain apps so dependencies only reference valid app names.
 * Dependencies must be an array of valid app names from the workspace.
 */
export type ConstrainedApps<TApps extends AppsRecord> = {
	[K in keyof TApps]: Omit<TApps[K], 'dependencies'> & {
		dependencies?: readonly (keyof TApps & string)[];
	};
};

/**
 * Full workspace input type with constrained dependencies.
 */
export type WorkspaceInput<TApps extends AppsRecord> = {
	name?: string;
	apps: ConstrainedApps<TApps>;
	shared?: SharedConfig;
	deploy?: DeployConfig;
	services?: ServicesConfig;
	secrets?: SecretsConfig;
};

/**
 * Extract app names from apps record.
 */
export type InferAppNames<TApps extends AppsRecord> = keyof TApps & string;

/**
 * Inferred workspace config with proper app name types.
 */
export type InferredWorkspaceConfig<TApps extends AppsRecord> = {
	name?: string;
	apps: {
		[K in keyof TApps]: Omit<TApps[K], 'dependencies'> & {
			dependencies?: InferAppNames<TApps>[];
		};
	};
	shared?: SharedConfig;
	deploy?: DeployConfig;
	services?: ServicesConfig;
	secrets?: SecretsConfig;
};

// Legacy types for backwards compatibility
/** @deprecated Use WorkspaceInput */
export type RawWorkspaceInput = {
	name?: string;
	apps: AppsRecord;
	shared?: SharedConfig;
	deploy?: DeployConfig;
	services?: ServicesConfig;
	secrets?: SecretsConfig;
};

/** @deprecated Use WorkspaceInput */
export type WorkspaceConfigInput<
	T extends RawWorkspaceInput = RawWorkspaceInput,
> = WorkspaceInput<T['apps']>;

/**
 * Workspace configuration for multi-app monorepos (legacy).
 * @deprecated Use WorkspaceConfigInput with defineWorkspace for type inference
 */
export interface WorkspaceConfig {
	/** Workspace name (defaults to root package.json name) */
	name?: string;

	/** App definitions */
	apps: Record<string, AppConfig>;

	/** Shared packages configuration */
	shared?: SharedConfig;

	/** Default deployment configuration */
	deploy?: DeployConfig;

	/** Development services (db, cache, mail) */
	services?: ServicesConfig;

	/** Encrypted secrets configuration */
	secrets?: SecretsConfig;
}

/**
 * Normalized app configuration with resolved defaults.
 */
export interface NormalizedAppConfig extends Omit<AppConfigBase, 'type'> {
	type: 'backend' | 'frontend';
	path: string;
	port: number;
	dependencies: string[];
	/** Resolved deploy target (app.deploy > deploy.default > 'dokploy') */
	resolvedDeployTarget: DeployTarget;
	/** Entry file path for non-gkm apps */
	entry?: string;
	/** Framework for the app */
	framework?: BackendFramework | FrontendFramework;
}

/**
 * Normalized workspace configuration with resolved defaults.
 */
export interface NormalizedWorkspace {
	name: string;
	root: string;
	apps: Record<string, NormalizedAppConfig>;
	services: ServicesConfig;
	deploy: DeployConfig;
	shared: SharedConfig;
	secrets: SecretsConfig;
}

/**
 * Result of loading and processing a configuration.
 */
export interface LoadedConfig {
	/** Whether this is a single-app or workspace config */
	type: 'single' | 'workspace';
	/** The raw configuration as loaded */
	raw: GkmConfig | WorkspaceConfig;
	/** Normalized workspace (always available) */
	workspace: NormalizedWorkspace;
}

/**
 * Type guard to check if a config is a WorkspaceConfig.
 */
export function isWorkspaceConfig(
	config: GkmConfig | WorkspaceConfig,
): config is WorkspaceConfig {
	return (
		typeof config === 'object' &&
		config !== null &&
		'apps' in config &&
		typeof config.apps === 'object'
	);
}
