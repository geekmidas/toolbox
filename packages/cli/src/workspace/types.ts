import type { z } from 'zod/v4';
import type { StateConfig } from '../deploy/StateProvider.js';
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
import type { DnsConfigWithLegacySchema, DnsProviderSchema } from './schema.js';

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
 * Project IDs are stored in deploy state (not config) and created on first deploy.
 *
 * @example Single endpoint for all stages:
 * ```ts
 * deploy: {
 *   default: 'dokploy',
 *   dokploy: {
 *     endpoint: 'https://dokploy.myserver.com',
 *     registry: 'ghcr.io/myorg',
 *   },
 * }
 * ```
 *
 * @example Per-stage endpoints (different Dokploy servers):
 * ```ts
 * deploy: {
 *   default: 'dokploy',
 *   dokploy: {
 *     endpoints: {
 *       development: 'https://dev-dokploy.myserver.com',
 *       production: 'https://dokploy.myserver.com',
 *     },
 *     registry: 'ghcr.io/myorg',
 *   },
 * }
 * ```
 */
export interface DokployWorkspaceConfig {
	/** Dokploy API endpoint for all stages */
	endpoint?: string;
	/** Per-stage Dokploy API endpoints (overrides endpoint) */
	endpoints?: Record<string, string>;
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
 * DNS provider types for automatic DNS record creation.
 */
export type DnsProviderType = 'hostinger' | 'route53' | 'cloudflare' | 'manual';

/**
 * DNS provider configuration for a single domain.
 */
export type DnsProvider = z.infer<typeof DnsProviderSchema>;

/**
 * DNS configuration for automatic record creation during deployment.
 *
 * Maps root domains to their DNS provider configuration.
 * When configured, the deploy command will automatically create DNS
 * A records pointing to your Dokploy server for each app's domain.
 *
 * @example
 * ```ts
 * // Multi-domain with different providers
 * dns: {
 *   'geekmidas.dev': { provider: 'hostinger' },
 *   'geekmidas.com': { provider: 'route53' },
 * }
 *
 * // Single domain
 * dns: {
 *   'traflabs.io': { provider: 'hostinger', ttl: 300 },
 * }
 *
 * // Manual mode - just print required records
 * dns: {
 *   'myapp.com': { provider: 'manual' },
 * }
 * ```
 */
export type DnsConfig = z.infer<typeof DnsConfigWithLegacySchema>;

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
 * // Full configuration with DNS
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
 *   dns: {
 *     provider: 'hostinger',
 *     domain: 'myapp.com',
 *   },
 * }
 * ```
 */
export interface DeployConfig {
	/** Default deploy target for all apps (default: 'dokploy') */
	default?: DeployTarget;
	/** Dokploy-specific configuration */
	dokploy?: DokployWorkspaceConfig;
	/** DNS configuration for automatic record creation */
	dns?: DnsConfig;
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
 *
 * @example
 * ```ts
 * // Backend app with gkm routes
 * api: {
 *   type: 'backend',
 *   path: 'apps/api',
 *   port: 3000,
 *   routes: './src/endpoints/**\/*.ts',
 *   envParser: './src/config/env',
 *   logger: './src/config/logger',
 * }
 *
 * // Backend app with entry point (e.g., Better Auth)
 * auth: {
 *   type: 'backend',
 *   path: 'apps/auth',
 *   port: 3001,
 *   entry: './src/index.ts',
 *   framework: 'better-auth',
 *   requiredEnv: ['DATABASE_URL', 'BETTER_AUTH_SECRET'],
 * }
 *
 * // Frontend app
 * web: {
 *   type: 'frontend',
 *   path: 'apps/web',
 *   port: 3002,
 *   framework: 'nextjs',
 *   dependencies: ['api', 'auth'],
 * }
 * ```
 */
interface AppConfigBase {
	/**
	 * App type.
	 * - 'backend': Server-side app (API, auth service, etc.)
	 * - 'frontend': Client-side app (Next.js, Vite, etc.)
	 * @default 'backend'
	 */
	type?: 'backend' | 'frontend';

	/**
	 * Path to the app relative to workspace root.
	 * @example 'apps/api', 'apps/web', 'services/auth'
	 */
	path: string;

	/**
	 * Development server port.
	 * Must be unique across all apps in the workspace.
	 * @example 3000, 3001, 3002
	 */
	port: number;

	/**
	 * Per-app deploy target override.
	 * Overrides `deploy.default` for this specific app.
	 * @example 'dokploy', 'vercel'
	 */
	deploy?: DeployTarget;

	// ─────────────────────────────────────────────────────────────────
	// Backend-specific (gkm routes mode)
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Routes glob pattern for gkm endpoints.
	 * @example './src/endpoints/**\/*.ts'
	 */
	routes?: Routes;

	/**
	 * Functions glob pattern for Lambda functions.
	 * @example './src/functions/**\/*.ts'
	 */
	functions?: Routes;

	/**
	 * Crons glob pattern for scheduled tasks.
	 * @example './src/crons/**\/*.ts'
	 */
	crons?: Routes;

	/**
	 * Subscribers glob pattern for event handlers.
	 * @example './src/subscribers/**\/*.ts'
	 */
	subscribers?: Routes;

	/**
	 * Path to environment parser module.
	 * @example './src/config/env'
	 */
	envParser?: string;

	/**
	 * Path to logger module.
	 * @example './src/config/logger'
	 */
	logger?: string;

	/** Provider configuration (AWS, Docker, etc.) */
	providers?: ProvidersConfig;

	/**
	 * Server lifecycle hooks.
	 * @example { beforeSetup: './src/hooks/setup.ts' }
	 */
	hooks?: HooksConfig;

	/**
	 * Telescope debugging dashboard configuration.
	 * @example true, './src/config/telescope', { enabled: true, path: '/__telescope' }
	 */
	telescope?: string | boolean | TelescopeConfig;

	/**
	 * Studio admin panel configuration.
	 * @example true, './src/config/studio'
	 */
	studio?: string | boolean | StudioConfig;

	/**
	 * OpenAPI documentation configuration.
	 * @example true, { output: './src/openapi.ts' }
	 */
	openapi?: boolean | OpenApiConfig;

	/**
	 * Runtime environment.
	 * @default 'node'
	 */
	runtime?: Runtime;

	/**
	 * Environment file(s) to load during development.
	 * @example '.env', ['.env', '.env.local']
	 */
	env?: string | string[];

	// ─────────────────────────────────────────────────────────────────
	// Entry point mode (non-gkm apps)
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Entry file path for apps that don't use gkm routes.
	 *
	 * When specified, the app is run directly with tsx in development
	 * and bundled with esbuild for production Docker builds.
	 *
	 * Use this for:
	 * - Better Auth servers
	 * - Custom Hono/Express apps
	 * - Any backend that doesn't use gkm's endpoint builder
	 *
	 * @example './src/index.ts', './src/server.ts'
	 */
	entry?: string;

	// ─────────────────────────────────────────────────────────────────
	// Frontend-specific
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Framework for the app.
	 *
	 * Backend frameworks: 'hono', 'better-auth', 'express', 'fastify'
	 * Frontend frameworks: 'nextjs', 'remix', 'vite'
	 *
	 * @example 'nextjs', 'better-auth', 'hono'
	 */
	framework?: BackendFramework | FrontendFramework;

	/**
	 * Client generation configuration.
	 * Generates typed API client from backend dependencies.
	 */
	client?: ClientConfig;

	/**
	 * Config file path(s) for frontend environment sniffing.
	 *
	 * Points to file(s) that call EnvironmentParser.parse() at import time.
	 * The sniffer imports these files and captures all env vars accessed.
	 *
	 * Dependencies are auto-generated as NEXT_PUBLIC_{DEP}_URL variables.
	 *
	 * @example Single config file
	 * ```ts
	 * config: './src/config/env'
	 * ```
	 *
	 * @example Separate client/server configs
	 * ```ts
	 * config: {
	 *   client: './src/config/client',  // NEXT_PUBLIC_* vars for browser
	 *   server: './src/config/server',  // Server-only vars for SSR
	 * }
	 * ```
	 */
	config?:
		| string
		| {
				/** Client-side config (NEXT_PUBLIC_* vars, available in browser) */
				client?: string;
				/** Server-side config (all env vars, for SSR/API routes) */
				server?: string;
		  };

	// ─────────────────────────────────────────────────────────────────
	// Deployment
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Override domain for this app.
	 *
	 * By default, apps get `{appName}.{baseDomain}` (or just `{baseDomain}`
	 * for the main frontend). Use this to specify a custom domain.
	 *
	 * @example
	 * ```ts
	 * // Single domain for all stages
	 * domain: 'api.custom.com'
	 *
	 * // Stage-specific domains
	 * domain: {
	 *   production: 'api.custom.com',
	 *   staging: 'api.staging.custom.com',
	 * }
	 * ```
	 */
	domain?: AppDomainConfig;

	/**
	 * Required environment variables for entry-based apps.
	 *
	 * Use this instead of envParser for apps that don't use gkm routes.
	 * The deploy command uses this list to filter which secrets to embed
	 * in the Docker image.
	 *
	 * @example ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'REDIS_URL']
	 */
	requiredEnv?: string[];
}

/**
 * App configuration input with type-safe dependencies.
 *
 * @template TAppNames - Union of valid app names in the workspace (auto-inferred)
 *
 * @example
 * ```ts
 * // Dependencies are type-checked against app names
 * apps: {
 *   api: { path: 'apps/api', port: 3000 },
 *   auth: { path: 'apps/auth', port: 3001 },
 *   web: {
 *     path: 'apps/web',
 *     port: 3002,
 *     type: 'frontend',
 *     dependencies: ['api', 'auth'],  // ✓ Valid
 *     // dependencies: ['invalid'],   // ✗ Type error
 *   },
 * }
 * ```
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
 *
 * @example
 * ```ts
 * import { defineWorkspace } from '@geekmidas/cli';
 *
 * export default defineWorkspace({
 *   name: 'my-app',
 *   apps: {
 *     api: {
 *       path: 'apps/api',
 *       port: 3000,
 *       routes: './src/endpoints/**\/*.ts',
 *     },
 *     web: {
 *       type: 'frontend',
 *       path: 'apps/web',
 *       port: 3001,
 *       framework: 'nextjs',
 *       dependencies: ['api'],
 *     },
 *   },
 *   services: {
 *     db: true,
 *     cache: true,
 *   },
 *   deploy: {
 *     default: 'dokploy',
 *   },
 * });
 * ```
 */
export type WorkspaceInput<TApps extends AppsRecord> = {
	/** Workspace name (defaults to root package.json name) */
	name?: string;
	/** App definitions */
	apps: ConstrainedApps<TApps>;
	/** Shared packages configuration */
	shared?: SharedConfig;
	/** Deployment configuration */
	deploy?: DeployConfig;
	/** Development services (db, cache, mail) */
	services?: ServicesConfig;
	/** Encrypted secrets configuration */
	secrets?: SecretsConfig;
	/** State provider configuration (local filesystem by default, or SSM for team collaboration) */
	state?: StateConfig;
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
	state?: StateConfig;
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
	state?: StateConfig;
};

/** @deprecated Use WorkspaceInput */
export type WorkspaceConfigInput<
	T extends RawWorkspaceInput = RawWorkspaceInput,
> = WorkspaceInput<T['apps']>;

/**
 * Workspace configuration for multi-app monorepos.
 *
 * Use `defineWorkspace()` helper for type-safe configuration with
 * auto-completion and dependency validation.
 *
 * @example
 * ```ts
 * // gkm.config.ts
 * import { defineWorkspace } from '@geekmidas/cli';
 *
 * export default defineWorkspace({
 *   name: 'my-saas',
 *
 *   // App definitions
 *   apps: {
 *     // Backend API with gkm routes
 *     api: {
 *       path: 'apps/api',
 *       port: 3000,
 *       routes: './src/endpoints/**\/*.ts',
 *       envParser: './src/config/env',
 *       logger: './src/config/logger',
 *       telescope: true,
 *     },
 *
 *     // Better Auth service
 *     auth: {
 *       path: 'apps/auth',
 *       port: 3001,
 *       entry: './src/index.ts',
 *       framework: 'better-auth',
 *       requiredEnv: ['DATABASE_URL', 'BETTER_AUTH_SECRET'],
 *     },
 *
 *     // Next.js frontend
 *     web: {
 *       type: 'frontend',
 *       path: 'apps/web',
 *       port: 3002,
 *       framework: 'nextjs',
 *       dependencies: ['api', 'auth'],
 *     },
 *   },
 *
 *   // Infrastructure services
 *   services: {
 *     db: true,      // PostgreSQL
 *     cache: true,   // Redis
 *   },
 *
 *   // Deployment configuration
 *   deploy: {
 *     default: 'dokploy',
 *     dokploy: {
 *       endpoint: 'https://dokploy.myserver.com',
 *       projectId: 'proj_abc123',
 *       registry: 'ghcr.io/myorg',
 *       domains: {
 *         production: 'myapp.com',
 *         staging: 'staging.myapp.com',
 *       },
 *     },
 *   },
 *
 *   // Shared packages
 *   shared: {
 *     packages: ['packages/*'],
 *     models: { path: 'packages/models' },
 *   },
 * });
 * ```
 *
 * @deprecated Use WorkspaceInput with defineWorkspace for type inference
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

	/** State provider configuration (local filesystem by default, or SSM for team collaboration) */
	state?: StateConfig;
}

/**
 * Normalized app configuration with resolved defaults.
 *
 * This is the internal representation after processing user input.
 * All optional fields have been resolved to their defaults.
 */
export interface NormalizedAppConfig extends Omit<AppConfigBase, 'type'> {
	/** App type (always defined after normalization) */
	type: 'backend' | 'frontend';
	/** Path to the app */
	path: string;
	/** Development server port */
	port: number;
	/** Resolved dependencies array (empty array if none) */
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
 *
 * This is the internal representation after processing user input.
 * All optional fields have been resolved to their defaults.
 */
export interface NormalizedWorkspace {
	/** Workspace name (resolved from package.json if not specified) */
	name: string;
	/** Absolute path to workspace root */
	root: string;
	/** Normalized app configurations */
	apps: Record<string, NormalizedAppConfig>;
	/** Services configuration (empty object if not specified) */
	services: ServicesConfig;
	/** Deploy configuration (empty object if not specified) */
	deploy: DeployConfig;
	/** Shared packages configuration (empty object if not specified) */
	shared: SharedConfig;
	/** Secrets configuration (empty object if not specified) */
	secrets: SecretsConfig;
	/** State provider configuration (undefined = local filesystem) */
	state?: StateConfig;
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
 *
 * @example
 * ```ts
 * const config = await loadConfig();
 * if (isWorkspaceConfig(config)) {
 *   // config.apps is available
 *   console.log(Object.keys(config.apps));
 * }
 * ```
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
