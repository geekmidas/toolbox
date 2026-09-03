import type { ServicesConfig } from './workspace/types.js';

export type MainProvider = 'aws' | 'server';
export type LegacyProvider =
	| 'server'
	| 'aws-apigatewayv1'
	| 'aws-apigatewayv2'
	| 'aws-lambda';

export interface PartitionedRoutes {
	paths: string | string[];
	partition: (filepath: string) => string;
}

export type Routes = string | string[] | PartitionedRoutes;

export function isPartitionedRoutes(
	routes: Routes | undefined,
): routes is PartitionedRoutes {
	return (
		typeof routes === 'object' &&
		routes !== null &&
		!Array.isArray(routes) &&
		'paths' in routes
	);
}

export interface ProviderConfig {
	enabled?: boolean;
	outputDir?: string;
}

export interface AWSApiGatewayConfig extends ProviderConfig {
	// Additional AWS API Gateway specific options
}

export interface AWSLambdaConfig extends ProviderConfig {
	// Additional AWS Lambda specific options
}

export interface ProductionConfig {
	/** Enable production mode (default: false) */
	enabled?: boolean;
	/** Bundle server into single file (default: true) */
	bundle?: boolean;
	/** Minify bundled output (default: true) */
	minify?: boolean;
	/** Health check endpoint path (default: '/health') */
	healthCheck?: string;
	/** Enable graceful shutdown handling (default: true) */
	gracefulShutdown?: boolean;
	/** Packages to exclude from bundling (default: []) */
	external?: string[];
	/** Include subscribers in production build (default: 'exclude' for serverless) */
	subscribers?: 'include' | 'exclude';
	/** Include OpenAPI spec in production (default: false) */
	openapi?: boolean;
	/**
	 * Enable build-time optimized handler generation (default: true)
	 * Generates specialized handlers based on endpoint tier:
	 * - minimal: Near-raw-Hono performance for simple endpoints
	 * - standard: Optimized handlers for auth/services
	 * - full: Uses HonoEndpoint.addRoutes for complex endpoints
	 */
	optimizedHandlers?: boolean;
}

/** Service-specific configuration for docker-compose */
export interface ServiceConfig {
	/**
	 * Full Docker image reference (e.g., 'postgis/postgis:16-3.4-alpine').
	 * When specified, overrides the default image entirely.
	 */
	image?: string;
	/**
	 * Docker image version/tag (e.g., '15-alpine' for postgres).
	 * Only used when `image` is not specified.
	 */
	version?: string;
}

/**
 * Supported event backend types.
 *
 * - `pgboss`: Reuses PostgreSQL with a dedicated user/schema. Auto-enables db service.
 * - `sns`: Adds LocalStack container with SNS+SQS services.
 * - `rabbitmq`: Adds RabbitMQ container.
 *
 * All backends generate EVENT_PUBLISHER_CONNECTION_STRING and EVENT_SUBSCRIBER_CONNECTION_STRING.
 */
export type EventsBackend = 'pgboss' | 'sns' | 'rabbitmq';

/**
 * Where a declared cache actually lives.
 *
 * A deployment choice, not an application one — the same code caches into any
 * of these — so it is config here beside `events` rather than a field on the
 * construct. Each backend is consistent between local and deployed, which is
 * the property worth having: a cache that behaves differently in the two places
 * is worse than a slower one.
 *
 * - `upstash` (default) — HTTP with a token. Reachable from a Lambda with no
 *   VPC and no connection pool, which is why it is the default; locally the
 *   `serverless-redis-http` proxy in front of Redis speaks the same protocol.
 * - `elasticache` — the Redis wire protocol, inside a VPC. Locally, plain Redis.
 * - `db` — a table in the database the app already declared. No infrastructure
 *   at all, and the same relationship pg-boss has to Postgres: it creates its
 *   own table on first use and needs a declared database to live in.
 */
export type CacheBackend = 'upstash' | 'elasticache' | 'db';

/** The backend a project gets when it declares a cache and says nothing. */
export const DEFAULT_CACHE: CacheBackend = 'upstash';

/**
 * Who delivers a declared app's mail.
 *
 * Unlike a cache, this changes *nothing* about the client. Every backend speaks
 * SMTP, so the declaration's `smtp://` URL is true of all of them and only the
 * provisioner differs — which is the same reason the declaration has no
 * `provider` field and there is no `ses://` scheme.
 *
 * - `ses` (default) — the only backend that can be a *chain* of resources: an
 *   identity, a user, an access key, and an SMTP password derived from it,
 *   because SES issues IAM credentials rather than SMTP ones. Hand it a URL and
 *   it uses that instead, which is what you want when the credentials already
 *   exist — provisioning a second set of sending credentials for an identity
 *   that already has them is not a thing to do by default.
 * - `resend` — an API key you hold, composed into an SMTP URL. Nothing to
 *   provision: a SaaS account is not infrastructure.
 * - `smtp` — a URL supplied whole, for a relay somebody else runs.
 *
 * Locally every one of them is Mailpit, because locally none of it matters.
 */
export type EmailBackend = 'resend' | 'ses' | 'smtp';

/** The backend a project gets when it declares email and says nothing. */
export const DEFAULT_EMAIL: EmailBackend = 'ses';

/** Supported docker-compose service names */
export type ComposeServiceName =
	| 'postgres'
	| 'redis'
	| 'rabbitmq'
	| 'minio'
	| 'mailpit'
	| 'localstack';

/** Services configuration - can be boolean (use defaults) or object with version */
export type ComposeServicesConfig = {
	[K in ComposeServiceName]?: boolean | ServiceConfig;
};

export interface DockerConfig {
	/** Container registry URL (e.g., 'ghcr.io/myorg') */
	registry?: string;
	/** Docker image name (default: derived from package.json name) */
	imageName?: string;
	/** Base Docker image (default: 'node:22-alpine') */
	baseImage?: string;
	/** Container port (default: 3000) */
	port?: number;
	/** docker-compose services to include */
	compose?: {
		/**
		 * Services to include in docker-compose.
		 * Can be an object with service configs or an array of service names (legacy).
		 *
		 * @example Object format (recommended)
		 * services: {
		 *   postgres: { version: '15-alpine' },
		 *   redis: true,  // use default version
		 * }
		 *
		 * @example Array format (legacy, uses default versions)
		 * services: ['postgres', 'redis']
		 */
		services?: ComposeServicesConfig | ComposeServiceName[];
	};
}

export interface ServerConfig extends ProviderConfig {
	enableOpenApi?: boolean;
	port?: number;
	/** Production build configuration */
	production?: ProductionConfig;
}

export type Runtime = 'node' | 'bun';

export interface TelescopeConfig {
	/** Enable/disable telescope (default: true in development) */
	enabled?: boolean;
	/** Port for telescope to use (defaults to server port) */
	port?: number;
	/** Path prefix for telescope UI (default: /__telescope) */
	path?: string;
	/** Ignore patterns for telescope (e.g., ['/health', '/metrics']) */
	ignore?: string[];
	/** Record request/response bodies (default: true) */
	recordBody?: boolean;
	/** Maximum entries to keep in memory (default: 1000) */
	maxEntries?: number;
	/** Enable WebSocket for real-time updates (default: true, requires @hono/node-ws for Node.js) */
	websocket?: boolean;
}

export interface StudioConfig {
	/** Enable/disable studio (default: true in development) */
	enabled?: boolean;
	/** Path prefix for studio UI (default: /__studio) */
	path?: string;
	/** Schema to introspect (default: 'public') */
	schema?: string;
}

export interface OpenApiConfig {
	/** Enable OpenAPI generation (default: true) */
	enabled?: boolean;
	/** API title */
	title?: string;
	/** API version */
	version?: string;
	/** API description */
	description?: string;
}

export interface HooksConfig {
	/**
	 * Path to a module exporting server lifecycle hooks.
	 * The module should export `beforeSetup` and/or `afterSetup` functions.
	 *
	 * @example
	 * ```typescript
	 * // src/config/hooks.ts
	 * import type { Hono } from 'hono';
	 * import type { Logger } from '@geekmidas/logger';
	 * import type { EnvironmentParser } from '@geekmidas/envkit';
	 *
	 * // Called BEFORE gkm endpoints are registered
	 * export function beforeSetup(app: Hono, ctx: { envParser: EnvironmentParser; logger: Logger }) {
	 *   app.use('*', cors());
	 *   app.get('/custom/health', (c) => c.json({ status: 'ok' }));
	 * }
	 *
	 * // Called AFTER gkm endpoints are registered
	 * export function afterSetup(app: Hono, ctx: { envParser: EnvironmentParser; logger: Logger }) {
	 *   app.notFound((c) => c.json({ error: 'Not found' }, 404));
	 *   app.onError((err, c) => c.json({ error: err.message }, 500));
	 * }
	 * ```
	 */
	server?: string;
}

/** Dokploy deployment configuration */
export interface DokployProviderConfig {
	/** Dokploy API endpoint (e.g., 'https://dokploy.example.com') */
	endpoint: string;
	/** Project ID in Dokploy */
	projectId: string;
	/** Application ID in Dokploy */
	applicationId: string;
	/** Container registry (overrides docker.registry if set) */
	registry?: string;
	/** Registry ID in Dokploy (recommended for private registries) */
	registryId?: string;
}

export interface ProvidersConfig {
	aws?: {
		apiGateway?: {
			v1?: boolean | AWSApiGatewayConfig;
			v2?: boolean | AWSApiGatewayConfig;
		};
		lambda?: {
			functions?: boolean | AWSLambdaConfig;
			crons?: boolean | AWSLambdaConfig;
		};
	};
	server?: boolean | ServerConfig;
	/** Dokploy deployment configuration */
	dokploy?: boolean | DokployProviderConfig;
}

export interface GkmConfig {
	/**
	 * Where the things no construct implies live.
	 *
	 * The same block a workspace config carries, and the same split: `db` and
	 * `storage` are derived from the declared `KyselyDatabase` and
	 * `ObjectStorage` and are ignored here, while `cache`, `mail`, and `events`
	 * name a *backend* — where the cache lives, who delivers the mail, which
	 * broker carries events. A single-app project had no way to say any of that
	 * before, so its event backend could only be guessed.
	 */
	services?: ServicesConfig;
	/**
	 * Constructs glob pattern — one glob, every kind.
	 *
	 * What reconcile reads to derive the containers a stage needs: a database
	 * implies Postgres, objects imply MinIO, mail implies Mailpit. A glob per
	 * kind cannot find a resource, because a declared `ObjectStorage` has no
	 * kind to be listed under.
	 *
	 * @example './src/**\/*.ts'
	 */
	constructs?: Routes;
	routes: Routes;
	functions?: Routes;
	crons?: Routes;
	subscribers?: Routes;
	queues?: Routes;
	topics?: Routes;
	envParser: string;
	logger: string;
	providers?: ProvidersConfig;
	/**
	 * Server lifecycle hooks for customizing the Hono app.
	 * Allows adding custom routes, middleware, error handlers, etc.
	 *
	 * @example
	 * hooks: {
	 *   server: './src/config/hooks'
	 * }
	 */
	hooks?: HooksConfig;
	/**
	 * Telescope configuration for debugging/monitoring.
	 * Can be:
	 * - A string path to a module that exports a Telescope instance (recommended)
	 * - A boolean to enable/disable with defaults
	 * - A TelescopeConfig object for inline configuration
	 */
	telescope?: string | boolean | TelescopeConfig;
	/**
	 * Studio configuration for database browsing.
	 * Can be:
	 * - A string path to a module that exports a Studio instance (recommended)
	 * - A boolean to enable/disable with defaults
	 * - A StudioConfig object for inline configuration
	 *
	 * Requires a database connection configured via services.
	 */
	studio?: string | boolean | StudioConfig;
	/**
	 * OpenAPI generation configuration.
	 * Can be:
	 * - A boolean to enable/disable with defaults (output: ./src/api/openapi.ts)
	 * - An OpenApiConfig object for customization
	 *
	 * When enabled, OpenAPI spec is generated on startup and regenerated on route changes.
	 *
	 * @example
	 * openapi: true
	 *
	 * @example
	 * openapi: {
	 *   output: './src/api/openapi.ts',
	 *   title: 'My API',
	 *   version: '1.0.0',
	 * }
	 */
	openapi?: boolean | OpenApiConfig;
	/** Runtime to use for dev server (default: 'node') */
	runtime?: Runtime;
	/**
	 * Environment file(s) to load for development.
	 * Can be:
	 * - A string path to a single env file (e.g., '.env.local')
	 * - An array of paths to load in order (later files override earlier)
	 * - Defaults to '.env' if not specified
	 *
	 * @example
	 * env: '.env.local'
	 *
	 * @example
	 * env: ['.env', '.env.local']
	 */
	env?: string | string[];
	/**
	 * Docker deployment configuration.
	 * Used by `gkm docker` and `gkm prepack` commands.
	 *
	 * @example
	 * docker: {
	 *   registry: 'ghcr.io/myorg',
	 *   imageName: 'my-api',
	 *   compose: {
	 *     services: ['postgres', 'redis']
	 *   }
	 * }
	 */
	docker?: DockerConfig;
	/**
	 * Where this app deploys, and what the target needs to know.
	 *
	 * Absent until now, which meant a single-app project could not configure a
	 * Dokploy deploy at all: the wrap that turns one into a workspace hardcoded
	 * `{ default: 'dokploy' }` and dropped everything else, so there was no
	 * endpoint, no registry and no domain — and `resolveHost` failed with "no
	 * domain configured for stage" on a config that had nowhere to put one.
	 *
	 * The same shape a workspace config uses, so moving from one to the other is
	 * a rename rather than a rewrite.
	 */
	deploy?: import('./workspace/types').DeployConfig;
}

export interface BuildOptions {
	provider?: MainProvider;
	// Legacy support - will be deprecated
	providers?: LegacyProvider[];
	enableOpenApi?: boolean;
	/** Build for production (no dev tools, bundled output) */
	production?: boolean;
	/** Skip bundling step in production build */
	skipBundle?: boolean;
	/** Stage for secrets injection (e.g., 'production', 'staging') */
	stage?: string;
	/**
	 * When true, optional environment variables (those with `.optional()` or
	 * `.default()` in the envParser) are suffixed with `?` within each
	 * construct's `environment` array in the manifest (e.g. `PORT?`).
	 * Defaults to false.
	 */
	markOptional?: boolean;
}

/** Result from build command when secrets are injected */
export interface BuildResult {
	/** Ephemeral master key for deployment (only if stage was provided) */
	masterKey?: string;
}

// The deployment manifest types are a shared, dependency-free data contract
// in `@geekmidas/manifest`, re-exported here for back-compat with existing
// `@geekmidas/cli` imports.
export type {
	CronInfo,
	FunctionInfo,
	Manifest,
	QueueInfo,
	RouteInfo,
	SubscriberInfo,
	TopicInfo,
} from '@geekmidas/manifest';
