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
 *
 * Specifies where the app will be deployed.
 *
 * @example
 * ```ts
 * // Currently supported
 * deploy: 'dokploy'
 *
 * // Future support (not yet implemented)
 * deploy: 'vercel'
 * deploy: 'cloudflare'
 * ```
 */
export type DeployTarget = 'dokploy' | 'vercel' | 'cloudflare';

/**
 * Backend framework types for apps that don't use gkm routes.
 *
 * Used with `entry` to specify the framework for proper Docker builds.
 *
 * @example
 * ```ts
 * // Better Auth server
 * {
 *   entry: './src/index.ts',
 *   framework: 'better-auth',
 *   port: 3001,
 * }
 *
 * // Hono app without gkm routes
 * {
 *   entry: './src/server.ts',
 *   framework: 'hono',
 *   port: 3000,
 * }
 * ```
 */
export type BackendFramework = 'hono' | 'better-auth' | 'express' | 'fastify';

/**
 * Frontend framework types.
 *
 * @example
 * ```ts
 * // Next.js app
 * {
 *   type: 'frontend',
 *   framework: 'nextjs',
 *   port: 3000,
 * }
 *
 * // Vite SPA
 * {
 *   type: 'frontend',
 *   framework: 'vite',
 *   port: 5173,
 * }
 * ```
 */
export type FrontendFramework = 'nextjs' | 'remix' | 'vite';

/**
 * Service image configuration for custom Docker images.
 *
 * @example
 * ```ts
 * // Use specific version
 * db: { version: '16-alpine' }
 *
 * // Use custom image
 * db: { image: 'timescale/timescaledb:latest-pg16' }
 * ```
 */
export interface ServiceImageConfig {
	/** Docker image version/tag (e.g., '18-alpine') */
	version?: string;
	/** Full Docker image reference (overrides version) */
	image?: string;
}

/**
 * Mail service configuration.
 *
 * In development, uses Mailpit for email testing.
 * In production, uses SMTP configuration.
 *
 * @example
 * ```ts
 * services: {
 *   mail: {
 *     smtp: {
 *       host: 'smtp.sendgrid.net',
 *       port: 587,
 *       user: 'apikey',
 *       pass: process.env.SENDGRID_API_KEY,
 *     }
 *   }
 * }
 * ```
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
 *
 * Configures shared infrastructure services like databases and caches.
 * These are automatically provisioned in Dokploy during deployment.
 *
 * @example
 * ```ts
 * // Enable with defaults
 * services: {
 *   db: true,      // postgres:18-alpine
 *   cache: true,   // redis:8-alpine
 * }
 *
 * // Custom versions
 * services: {
 *   db: { version: '16-alpine' },
 *   cache: { version: '7-alpine' },
 * }
 *
 * // Custom images
 * services: {
 *   db: { image: 'timescale/timescaledb:latest-pg16' },
 * }
 *
 * // With mail service
 * services: {
 *   db: true,
 *   cache: true,
 *   mail: true,  // Mailpit in dev
 * }
 * ```
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
 * Stage-based domain configuration.
 *
 * Maps deployment stages to base domains. The main frontend app
 * gets the base domain, other apps get `{appName}.{baseDomain}`.
 *
 * @example
 * ```ts
 * domains: {
 *   development: 'dev.myapp.com',
 *   staging: 'staging.myapp.com',
 *   production: 'myapp.com',
 * }
 *
 * // Result for production stage:
 * // - web (main frontend): myapp.com
 * // - api: api.myapp.com
 * // - auth: auth.myapp.com
 * ```
 */
export type DokployDomainsConfig = Record<string, string>;

/**
 * Per-app domain override configuration.
 *
 * Can be a single domain string (used for all stages) or
 * stage-specific domains.
 *
 * @example
 * ```ts
 * // Single domain for all stages
 * domain: 'api.custom.com'
 *
 * // Stage-specific domains
 * domain: {
 *   development: 'api.dev.custom.com',
 *   staging: 'api.staging.custom.com',
 *   production: 'api.custom.com',
 * }
 * ```
 */
export type AppDomainConfig = string | Record<string, string>;

/**
 * Dokploy workspace deployment configuration.
 *
 * Configures how the workspace is deployed to a Dokploy server.
 * One workspace maps to one Dokploy project with stage-based environments.
 *
 * @example
 * ```ts
 * deploy: {
 *   default: 'dokploy',
 *   dokploy: {
 *     endpoint: 'https://dokploy.myserver.com',
 *     projectId: 'proj_abc123',
 *     registry: 'ghcr.io/myorg',
 *     domains: {
 *       development: 'dev.myapp.com',
 *       production: 'myapp.com',
 *     },
 *   },
 * }
 * ```
 */
export interface DokployWorkspaceConfig {
	/** Dokploy API endpoint (e.g., 'https://dokploy.myserver.com') */
	endpoint: string;
	/** Project ID in Dokploy (auto-created on first deploy) */
	projectId: string;
	/** Container registry for Docker images (e.g., 'ghcr.io/myorg') */
	registry?: string;
	/** Registry ID in Dokploy (auto-configured) */
	registryId?: string;
	/**
	 * Stage-based domain configuration.
	 * The main frontend app gets the base domain.
	 * Other apps get {appName}.{baseDomain} by default.
	 */
	domains?: DokployDomainsConfig;
}

/**
 * Deployment configuration for the workspace.
 *
 * @example
 * ```ts
 * // Minimal - just set default target
 * deploy: {
 *   default: 'dokploy',
 * }
 *
 * // Full Dokploy configuration
 * deploy: {
 *   default: 'dokploy',
 *   dokploy: {
 *     endpoint: 'https://dokploy.myserver.com',
 *     projectId: 'proj_abc123',
 *     registry: 'ghcr.io/myorg',
 *     domains: {
 *       production: 'myapp.com',
 *     },
 *   },
 * }
 * ```
 */
export interface DeployConfig {
	/** Default deploy target for all apps (default: 'dokploy') */
	default?: DeployTarget;
	/** Dokploy-specific configuration */
	dokploy?: DokployWorkspaceConfig;
}

/**
 * Models package configuration for shared schemas.
 *
 * Configures a shared models package containing Zod schemas
 * that can be used across backend and frontend apps.
 *
 * @example
 * ```ts
 * shared: {
 *   models: {
 *     path: 'packages/models',
 *     schema: 'zod',
 *   },
 * }
 * ```
 */
export interface ModelsConfig {
	/** Path to models package relative to workspace root (default: 'packages/models') */
	path?: string;
	/**
	 * Schema library to use (default: 'zod').
	 * Currently only 'zod' is supported.
	 * Future: any StandardSchema-compatible library
	 */
	schema?: 'zod';
}

/**
 * Shared packages configuration.
 *
 * Configures shared packages in the monorepo that are
 * used by multiple apps.
 *
 * @example
 * ```ts
 * shared: {
 *   packages: ['packages/*', 'libs/*'],
 *   models: {
 *     path: 'packages/models',
 *     schema: 'zod',
 *   },
 * }
 * ```
 */
export interface SharedConfig {
	/** Glob patterns for shared packages (default: ['packages/*']) */
	packages?: string[];
	/** Models package configuration */
	models?: ModelsConfig;
}

/**
 * Secrets encryption configuration.
 *
 * Configures how secrets are encrypted for deployment.
 * Secrets are stored encrypted in `.gkm/secrets/{stage}.json`
 * with keys stored separately in `~/.gkm/{project}/{stage}.key`.
 *
 * @example
 * ```ts
 * secrets: {
 *   enabled: true,
 *   algorithm: 'aes-256-gcm',
 *   kdf: 'scrypt',
 * }
 * ```
 */
export interface SecretsConfig {
	/** Enable encrypted secrets (default: true) */
	enabled?: boolean;
	/** Encryption algorithm (default: 'aes-256-gcm') */
	algorithm?: string;
	/** Key derivation function (default: 'scrypt') */
	kdf?: 'scrypt' | 'pbkdf2';
}

/**
 * Client generation configuration for frontend apps.
 *
 * Configures automatic API client generation from OpenAPI specs.
 *
 * @example
 * ```ts
 * // In a frontend app config
 * {
 *   type: 'frontend',
 *   framework: 'nextjs',
 *   dependencies: ['api'],
 *   client: {
 *     output: './src/lib/api',
 *   },
 * }
 * ```
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

	// Deployment
	/**
	 * Override domain for this app (per-stage or single value).
	 * @example 'api.custom.com' or { production: 'api.custom.com', staging: 'api.staging.com' }
	 */
	domain?: AppDomainConfig;

	/**
	 * Required environment variables for entry-based apps.
	 * Use this instead of envParser for apps that don't use gkm routes.
	 * The deploy command uses this to filter which secrets to embed.
	 * @example ['DATABASE_URL', 'BETTER_AUTH_SECRET']
	 */
	requiredEnv?: string[];
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
	/** Override domain for this app */
	domain?: AppDomainConfig;
	/** Required environment variables for entry-based apps */
	requiredEnv?: string[];
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
