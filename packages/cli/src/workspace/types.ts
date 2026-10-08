import type { ConstructManifest } from '@geekmidas/manifest';
import type { AwsRegion, StateConfig } from '../deploy/StateProvider.js';
import type { DeployTargetEntry } from '../target/types';

export type { AwsRegion };

import type {
	GkmConfig,
	HooksConfig,
	OpenApiConfig,
	Routes,
	Runtime,
	TelescopeConfig,
} from '../types.js';
import type {
	BackendFramework,
	BackupsConfig,
	DnsConfig,
	DnsProvider,
	Framework,
	FrontendFramework,
	MobileFramework,
} from './schema.js';

export type {
	BackendFramework,
	BackupsConfig,
	DnsConfig,
	DnsProvider,
	Framework,
	FrontendFramework,
	MobileFramework,
};

/**
 * Where a stage — or one app — deploys, by target name: a built-in
 * (`dokploy`, `sst`) or a key of `deploy.targets`.
 *
 * @example
 * ```ts
 * deploy: 'dokploy'
 * deploy: 'acme' // deploy: { targets: { acme: '@acme/gkm-target' } }
 * ```
 */
export type DeployTargetName = 'dokploy' | 'compose' | 'sst' | (string & {});

/**
 * Each deployed stage's base domain — `deploy.domains`.
 *
 * A fact about the deployment rather than the platform, so every target reads
 * it. The root site answers on the base domain; every other surface on
 * `{subdomain}.{domain}`, where the subdomain is the construct's own
 * `subdomain`, or its id kebab-cased.
 *
 * @example
 * ```ts
 * deploy: {
 *   domains: { production: 'myapp.com', staging: 'staging.myapp.com' },
 * }
 *
 * // production:
 * // - new StaticSite('Web', { root: true })        → myapp.com
 * // - new RestApi('Api', { subdomain: 'api' })    → api.myapp.com
 * // - new RestApi('Webhooks', { … })              → webhooks.myapp.com
 * ```
 */
export type DomainsConfig = Record<string, string>;

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
 *   registry: 'ghcr.io/myorg',
 *   dokploy: {
 *     endpoint: 'https://dokploy.myserver.com',
 *   },
 * }
 * ```
 *
 * @example Per-stage endpoints (different Dokploy servers):
 * ```ts
 * deploy: {
 *   default: 'dokploy',
 *   registry: 'ghcr.io/myorg',
 *   dokploy: {
 *     endpoints: {
 *       development: 'https://dev-dokploy.myserver.com',
 *       production: 'https://dokploy.myserver.com',
 *     },
 *   },
 * }
 * ```
 */
export interface DokployWorkspaceConfig {
	/** Dokploy API endpoint for all stages */
	endpoint?: string;
	/** Per-stage Dokploy API endpoints (overrides endpoint) */
	endpoints?: Record<string, string>;
	/** Registry ID in Dokploy (auto-configured) */
	registryId?: string;
	/** How a release is waited for and checked before it counts as live. */
	verify?: DokployVerifyConfig;
}

/**
 * How a Dokploy release is waited for and checked.
 *
 * A release counts once Dokploy's deployment has finished and the app has
 * answered its health route `healthyAfter` times in a row. One that does not
 * is rolled back.
 */
export interface DokployVerifyConfig {
	/** How long Dokploy may take to finish a deployment. Default 10 minutes. */
	deploymentTimeoutMs?: number;
	/**
	 * The path each backend is checked on, under its domain. Default
	 * `/health`, which every production server build serves. A site is
	 * checked at `/`.
	 */
	healthCheckPath?: string;
	/** Consecutive 2xx answers that make an app healthy. Default 3. */
	healthyAfter?: number;
	/** Between health checks, and the first wait between polls. Default 2s. */
	intervalMs?: number;
	/** How long an app may take to become healthy. Default 5 minutes. */
	healthTimeoutMs?: number;
}

/**
 * The `compose` target's own settings — `deploy.compose`. Read by `gkm
 * compose` and `gkm deploy --target compose` only; the Dokploy target never
 * consults it.
 *
 * @example
 * ```ts
 * deploy: { compose: { logs: true } }
 * deploy: { compose: { logs: { port: 5081, retentionDays: 14 } } }
 * deploy: { compose: { logs: { public: { allow: ['203.0.113.7', '10.0.0.0/8'] } } } }
 * ```
 */
export interface ComposeWorkspaceConfig {
	/**
	 * Run OpenObserve in the stack and send every backend's logs and traces
	 * to it. `true` for the defaults.
	 */
	logs?: boolean | ComposeLogsConfig;
	/**
	 * What serves a deployed stage's stack: `'caddy'` (the default) — the
	 * stack's own Caddy on 80/443 — or `'traefik'`, the server's shared
	 * Traefik edge, which every stack registers its routes with. One value
	 * for every deployed stage, or one per stage. The local stage is always
	 * Caddy.
	 *
	 * ```ts
	 * proxy: 'traefik'
	 * proxy: { staging: 'traefik', production: 'caddy' }
	 * ```
	 */
	proxy?: ComposeProxy | Record<string, ComposeProxy>;
	/**
	 * A deployed stage's own certificate, by stage, instead of one from
	 * Let's Encrypt: a PEM certificate (with its chain) and its key, relative
	 * to the workspace root or absolute. Either proxy serves it.
	 *
	 * ```ts
	 * tls: { production: { certFile: 'certs/origin.pem', keyFile: 'certs/origin.key' } }
	 * ```
	 */
	tls?: Record<string, ComposeTlsConfig>;
}

/** The proxies a compose stack can be served by — `deploy.compose.proxy`. */
export type ComposeProxy = 'caddy' | 'traefik';

/** A stage's own certificate — `deploy.compose.tls.<stage>`. */
export interface ComposeTlsConfig {
	certFile: string;
	keyFile: string;
}

/** How the stack's OpenObserve is run and reached — `deploy.compose.logs`. */
export interface ComposeLogsConfig {
	/**
	 * The port it is published on, on 127.0.0.1 only — reached from another
	 * machine through an SSH tunnel. Default 5080.
	 */
	port?: number;
	/**
	 * How many days of data it keeps (OpenObserve's
	 * `ZO_COMPACT_DATA_RETENTION_DAYS`). At least 3; default 30.
	 */
	retentionDays?: number;
	/**
	 * Serve it on `logs.<stage domain>` through the stack's Caddy, to these
	 * addresses only (IPs or CIDRs), instead of on a loopback port. Every
	 * other address is answered 403.
	 */
	public?: { allow: string[] };
}

/**
 * DNS provider types for automatic DNS record creation.
 */
export type DnsProviderType = 'hostinger' | 'route53' | 'cloudflare' | 'manual';

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
 * // Full configuration with DNS and backups
 * deploy: {
 *   default: 'dokploy',
 *   registry: 'ghcr.io/myorg',
 *   dokploy: {
 *     endpoint: 'https://dokploy.myserver.com',
 *     projectId: 'proj_abc123',
 *     domains: {
 *       production: 'myapp.com',
 *     },
 *   },
 *   dns: {
 *     provider: 'hostinger',
 *     domain: 'myapp.com',
 *   },
 *   backups: {
 *     type: 's3',
 *     region: 'us-east-1',
 *   },
 * }
 * ```
 */
export interface DeployConfig {
	/** Default deploy target for all apps (default: 'dokploy') */
	default?: DeployTargetName;
	/**
	 * Targets that do not ship with the CLI, by the name `default` (or an
	 * app's `deploy`) uses: a package whose default export is the target, a
	 * target object, or either with its options.
	 *
	 * ```ts
	 * targets: {
	 *   acme: '@acme/gkm-target',
	 *   fly: ['@acme/gkm-fly', { org: 'acme' }],
	 *   local: defineTarget({ … }),
	 * }
	 * ```
	 *
	 * A package is never guessed from a name: it is installed and listed here.
	 * A built-in's name cannot be taken.
	 */
	targets?: Record<string, DeployTargetEntry>;
	/**
	 * Whose deploy this is, on a target shared with other workspaces — an
	 * organisation or a team, lowercase `[a-z0-9-]`. Two workspaces with the
	 * same name deploying to one Dokploy are kept apart by it: it is in the
	 * project's ownership marker, the image path
	 * (`<registry>/<namespace>/<project>-<app>`) and every resource name.
	 *
	 * Defaults to the kebab-cased workspace name, which adds nothing to the
	 * names a workspace was already deployed under.
	 */
	namespace?: string;
	/** Each deployed stage's base domain — see {@link DomainsConfig}. */
	domains?: DomainsConfig;
	/**
	 * The container registry the apps' images are pushed to and pulled from,
	 * whatever the target — `ghcr.io/myorg`. An image is
	 * `<registry>/<namespace>/<project>-<app>:<tag>`.
	 */
	registry?: string;
	/** Dokploy-specific configuration */
	dokploy?: DokployWorkspaceConfig;
	/** What the `compose` target runs beside the apps — see {@link ComposeWorkspaceConfig}. */
	compose?: ComposeWorkspaceConfig;
	/** DNS configuration for automatic record creation */
	dns?: DnsConfig;
	/** Backup destination configuration for database services */
	backups?: BackupsConfig;
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
 * The project's stages, named by the project.
 *
 * Stage names were literals scattered through the CLI — `gkm dev` ran as
 * `development` and looked for `dev` secrets first, a deploy script said
 * `production` — so a team that called its stages anything else was
 * working against the tool. They are declared once, here, and read.
 *
 * @example
 * ```ts
 * stages: { local: 'dev', deployed: ['staging', 'prod'], protected: ['prod'] }
 * ```
 */
export interface StagesConfig {
	/**
	 * What `gkm dev`, `exec`, `setup` and `test` run as: the stage whose
	 * secrets are read locally, and whose containers carry no suffix.
	 *
	 * Never also a deployed stage. Secrets are stored per stage name, so a
	 * deployed stage sharing it would share its secrets with every laptop.
	 */
	local: string;
	/** The stages `gkm deploy --stage` accepts. */
	deployed: string[];
	/**
	 * Deployed stages whose resources outlive the stack that made them —
	 * retained on removal and protected, e.g. the stage users are on.
	 */
	protected?: string[];
}

/**
 * Secrets encryption configuration.
 *
 * Configures how secrets are encrypted for deployment.
 * Secrets are stored encrypted in `.gkm/secrets/{stage}.json`
 * with keys stored separately in `~/.gkm/keys/{namespace}/{project}/{stage}.key`.
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
	/**
	 * Where deployed stages' secrets live, so a deploy can reach them from
	 * anywhere: `'file'` (default — the encrypted `.gkm/secrets/<stage>.json`,
	 * which cannot serve CI while `.gkm/` is gitignored), `{ provider: 'ssm',
	 * region }` (each stage's secrets in an SSM parameter in its own AWS
	 * account, up to 8 KB), `{ provider: 'secrets-manager', region, kmsKeyId? }`
	 * (a Secrets Manager secret in its own account, up to 64 KB), or any object
	 * implementing `SecretsStore`. The local stage always uses the file.
	 */
	store?: import('../secrets/store.js').SecretsStoreConfig;
	/** Encryption algorithm (default: 'aes-256-gcm') */
	algorithm?: string;
	/** Key derivation function (default: 'scrypt') */
	kdf?: 'scrypt' | 'pbkdf2';
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
 *   type: 'web',
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
	 * - 'web': Client-side web app (Next.js, Vite, TanStack Start, etc.)
	 * - 'mobile': Native mobile app (Expo). Built/deployed via its own
	 *   toolchain (e.g. EAS Build) — Docker/Dokploy steps are skipped.
	 * @default 'backend'
	 */
	type?: 'backend' | 'web' | 'mobile';

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
	deploy?: DeployTargetName;

	// ─────────────────────────────────────────────────────────────────
	// Backend-specific (gkm routes mode)
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Constructs glob pattern — one glob, every kind.
	 *
	 * A glob per kind cannot find a resource, because a declared `ObjectStorage`
	 * has no kind to be listed under. This one is what reconcile reads to derive
	 * the containers a stage needs, and it replaces the per-kind globs below.
	 *
	 * @example './src/**\/*.ts'
	 */
	constructs?: Routes;

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
	 * Queues glob pattern for point-to-point workers.
	 * @example './src/queues/**\/*.ts'
	 */
	queues?: Routes;

	/**
	 * Topics glob pattern for the topics subscribers bind to.
	 * @example './src/topics/**\/*.ts'
	 */
	topics?: Routes;

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

	/**
	 * Server lifecycle hooks.
	 * @example { beforeSetup: './src/hooks/setup.ts' }
	 */
	hooks?: HooksConfig;

	/**
	 * Telescope request recording configuration.
	 * @example true, './src/config/telescope', { enabled: true, path: '/__telescope' }
	 */
	telescope?: string | boolean | TelescopeConfig;

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
	 * Frontend frameworks: 'nextjs', 'remix', 'vite', 'tanstack-start'
	 * Mobile frameworks: 'expo'
	 *
	 * @example 'nextjs', 'better-auth', 'hono', 'expo'
	 */
	framework?: Framework;

	/**
	 * Config file paths for frontend environment sniffing.
	 *
	 * Points to file(s) that call EnvironmentParser.parse() at import time.
	 * The sniffer imports these files and captures all env vars accessed.
	 *
	 * Dependencies are auto-generated as public-prefixed URL vars based on
	 * the app's framework (e.g. `NEXT_PUBLIC_{DEP}_URL` for Next.js,
	 * `VITE_{DEP}_URL` for Vite/TanStack Start, `EXPO_PUBLIC_{DEP}_URL`
	 * for Expo).
	 *
	 * @example
	 * ```ts
	 * config: {
	 *   client: './src/config/client.ts',  // public-prefixed vars for browser
	 *   server: './src/config/server.ts',  // server-only vars for SSR
	 * }
	 * ```
	 */
	config?: {
		/** Client-side config (public-prefixed vars, available in browser/device) */
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
 *     type: 'web',
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
 *       type: 'web',
 *       path: 'apps/web',
 *       port: 3001,
 *       framework: 'nextjs',
 *       dependencies: ['api'],
 *     },
 *   },
 *   deploy: {
 *     default: 'dokploy',
 *   },
 * });
 * ```
 */
export type WorkspaceInput<TApps extends AppsRecord> = {
	/**
	 * Where the workspace's own constructs live, relative to its root.
	 *
	 * The product's infrastructure, declared once for every app that consumes
	 * it. Additive with an app's own glob rather than replacing it.
	 */
	constructs?: Routes;
	/** Workspace name (defaults to root package.json name) */
	name?: string;
	/**
	 * Apps that nothing declares.
	 *
	 * Normally absent: a `site` is an app and so is a `rest-api` that named
	 * one, so the list is read off the graph. This is the escape hatch for what
	 * no construct describes.
	 */
	apps?: ConstrainedApps<TApps>;
	/** Shared packages configuration */
	shared?: SharedConfig;
	/** Deployment configuration */
	deploy?: DeployConfig;
	/** The project's stages: which one is local, which deploy */
	stages: StagesConfig;
	/** Encrypted secrets configuration */
	secrets?: SecretsConfig;
	/** State provider configuration (local filesystem by default, or SSM for team collaboration) */
	state?: StateConfig;
	/** How `gkm dev` is reached: the discovery endpoint's port and origins */
	dev?: DevConfig;
};

/**
 * How `gkm dev` is reached from outside the apps it runs.
 */
export interface DevConfig {
	/**
	 * Browser origins allowed to read the discovery endpoint — and this
	 * workspace in it — e.g. `['https://console.example.com']`.
	 *
	 * Empty by default: any page the developer visits can send requests to a
	 * loopback port, so none is answered unless it is listed here. A request
	 * with no `Origin` (curl, a local process) still needs the session token.
	 */
	allowedOrigins?: string[];
	/**
	 * The loopback port the discovery endpoint listens on. Defaults to 4983;
	 * `GKM_DISCOVERY_PORT` overrides it.
	 */
	discoveryPort?: number;
}

/**
 * How `gkm test` builds what a feature test is handed.
 */
export interface TestConfig {
	/**
	 * The folder of test factories, relative to the root.
	 *
	 * Defaults to `test/factories`. A factory belongs to a database, not to an
	 * app, so each file is named after one — `database.ts` for `Database`,
	 * `auth-database.ts` for `AuthDatabase` — and exports `createFactory(db)`.
	 * Every app's harness builds them on each test's transactions, and a test is
	 * handed them as `factories`, keyed by service name.
	 */
	factories?: string;
}

/**
 * Extract app names from apps record.
 */
export type InferAppNames<TApps extends AppsRecord> = keyof TApps & string;

/**
 * Inferred workspace config with proper app name types.
 */
export type InferredWorkspaceConfig<TApps extends AppsRecord> = {
	/**
	 * Where the workspace's own constructs live, relative to its root.
	 *
	 * The product's infrastructure, declared once for every app that consumes
	 * it. Additive with an app's own glob rather than replacing it.
	 */
	constructs?: Routes;
	name?: string;
	apps?: {
		[K in keyof TApps]: Omit<TApps[K], 'dependencies'> & {
			dependencies?: InferAppNames<TApps>[];
		};
	};
	shared?: SharedConfig;
	deploy?: DeployConfig;
	stages: StagesConfig;
	secrets?: SecretsConfig;
	state?: StateConfig;
	test?: TestConfig;
	dev?: DevConfig;
};

// Legacy types for backwards compatibility
/** @deprecated Use WorkspaceInput */
export type RawWorkspaceInput = {
	name?: string;
	apps: AppsRecord;
	shared?: SharedConfig;
	deploy?: DeployConfig;
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
 *       type: 'web',
 *       path: 'apps/web',
 *       port: 3002,
 *       framework: 'nextjs',
 *       dependencies: ['api', 'auth'],
 *     },
 *   },
 *
 *   // Deployment configuration
 *   deploy: {
 *     default: 'dokploy',
 *     registry: 'ghcr.io/myorg',
 *     domains: {
 *       production: 'myapp.com',
 *       staging: 'staging.myapp.com',
 *     },
 *     dokploy: {
 *       endpoint: 'https://dokploy.myserver.com',
 *       projectId: 'proj_abc123',
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
	/**
	 * Where the workspace's own constructs live, relative to its root.
	 *
	 * The product's infrastructure, declared once for every app that consumes
	 * it. Additive with an app's own glob rather than replacing it.
	 */
	constructs?: Routes;
	/** Workspace name (defaults to root package.json name) */
	name?: string;

	/** Apps that nothing declares. Normally absent — see `WorkspaceInput`. */
	apps?: Record<string, AppConfig>;

	/** Shared packages configuration */
	shared?: SharedConfig;

	/** Default deployment configuration */
	deploy?: DeployConfig;

	/** The project's stages: which one is local, which deploy */
	stages: StagesConfig;

	/** Encrypted secrets configuration */
	secrets?: SecretsConfig;

	/** State provider configuration (local filesystem by default, or SSM for team collaboration) */
	state?: StateConfig;

	/** What `gkm test` hands a feature test: where the factories are. */
	test?: TestConfig;

	/** How `gkm dev` is reached: the discovery endpoint's port and origins. */
	dev?: DevConfig;
}

/**
 * Normalized app configuration with resolved defaults.
 *
 * This is the internal representation after processing user input.
 * All optional fields have been resolved to their defaults.
 */
export interface NormalizedAppConfig extends Omit<AppConfigBase, 'type'> {
	/**
	 * Whether the base domain points at this site.
	 *
	 * Carried from the `site` declaration rather than configured, because which
	 * site is primary is structural — its *hostname* is what varies by stage,
	 * and that is `domain`.
	 */
	root?: boolean;

	/**
	 * The label this app answers on under a stage's domain, carried from its
	 * declaration — `api` for `api.myapp.com`. Absent, the app's own name.
	 */
	subdomain?: string;

	/** App type (always defined after normalization) */
	type: 'backend' | 'web' | 'mobile';
	/** Path to the app */
	path: string;
	/** Development server port */
	port: number;
	/** Resolved dependencies array (empty array if none) */
	dependencies: string[];
	/** Resolved deploy target (app.deploy > deploy.default > 'dokploy') */
	resolvedDeployTarget: DeployTargetName;
	/** Entry file path for non-gkm apps */
	entry?: string;
	/** Framework for the app */
	framework?: Framework;
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
	/**
	 * The workspace's own constructs glob, relative to `root`.
	 *
	 * Where the product's shared infrastructure is declared. Additive with each
	 * app's glob, so an app can still declare something only it uses.
	 */
	constructs?: Routes;
	/** Normalized app configurations */
	apps: Record<string, NormalizedAppConfig>;
	/** Deploy configuration (empty object if not specified) */
	deploy: DeployConfig;
	/** Shared packages configuration (empty object if not specified) */
	shared: SharedConfig;
	/** The project's stages, as declared */
	stages: StagesConfig;
	/** Secrets configuration (empty object if not specified) */
	secrets: SecretsConfig;
	/** State provider configuration (undefined = local filesystem) */
	state?: StateConfig;
	/** What `gkm test` hands a feature test (empty object if not specified) */
	test: TestConfig;
	/** How `gkm dev` is reached, when configured */
	dev?: DevConfig;
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
	/**
	 * What the workspace's constructs declared, when it has any.
	 *
	 * Read once at load, because the apps above are derived from it and a
	 * caller that re-discovers would be answering the same question twice with
	 * two chances to disagree. Absent when the workspace declares no constructs.
	 */
	manifest?: ConstructManifest;
	/**
	 * The files each Worker's crons, queues and subscribers are declared in,
	 * read in the same discovery — what says which app a worker is built from.
	 */
	background?: Record<string, string[]>;
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
	if (typeof config !== 'object' || config === null) return false;

	// `apps` used to be the only tell, and it stopped being one when apps
	// became derived: a workspace that declares its apps through constructs has
	// none. `constructs` at the top level is the other tell — a single-app
	// `defineConfig` has no notion of a workspace-wide glob — and either alone
	// is enough.
	if ('apps' in config && typeof config.apps === 'object') return true;

	// Only when nothing else says it is one app. `openapi`, `telescope`,
	// `hooks` and the rest configure a single process, so a config that
	// sets any of them is that process's — the workspace schema is strict,
	// and reading one of these as a workspace would reject what it was never
	// meant to accept.
	return (
		'constructs' in config &&
		Object.keys(config).every((key) => WORKSPACE_KEYS.has(key))
	);
}

/** Every top-level key a workspace config has — see `WorkspaceConfigSchema`. */
const WORKSPACE_KEYS: ReadonlySet<string> = new Set([
	'name',
	'constructs',
	'apps',
	'shared',
	'deploy',
	'stages',
	'secrets',
	'state',
]);
