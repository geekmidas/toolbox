import { z } from 'zod/v4';
import { checkStageBackups } from '../backups/schedule.js';
import { checkDnsRecordsMode } from '../compose/dnsConfig.js';
import { checkComposeStages } from '../compose/proxy.js';
import { checkStageProvider } from '../providers/config.js';
import { s3SecretsLocation } from '../secrets/providers.js';
import {
	BUILTIN_TARGETS,
	builtinTarget,
	configurableBuiltins,
} from '../target/builtins.js';
import { isDeployTarget } from '../target/define.js';
import { checkStageTelemetry } from '../telemetry/config.js';
import { assertDeployedStageKeys, stageProblems } from './stages.js';

/** Routes are a glob, or a list of them. */
const RoutesSchema = z.union([z.string(), z.array(z.string())]);

/**
 * Telescope configuration schema.
 */
const TelescopeConfigSchema = z.object({
	enabled: z.boolean().optional(),
	port: z.number().optional(),
	path: z.string().optional(),
	ignore: z.array(z.string()).optional(),
	recordBody: z.boolean().optional(),
	maxEntries: z.number().optional(),
	websocket: z.boolean().optional(),
});

/**
 * OpenAPI configuration schema.
 */
const OpenApiConfigSchema = z.object({
	enabled: z.boolean().optional(),
	title: z.string().optional(),
	version: z.string().optional(),
	description: z.string().optional(),
});

/**
 * Hooks configuration schema.
 */
const HooksConfigSchema = z.object({
	server: z.string().optional(),
});

/**
 * Backend framework schema for non-gkm apps.
 */
export const BackendFrameworkSchema = z.enum([
	'hono',
	'better-auth',
	'express',
	'fastify',
]);

/**
 * Backend framework types for apps that don't use gkm routes.
 * Derived from {@link BackendFrameworkSchema}.
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
export type BackendFramework = z.infer<typeof BackendFrameworkSchema>;

/**
 * Frontend framework schema.
 */
export const FrontendFrameworkSchema = z.enum([
	'nextjs',
	'remix',
	'vite',
	'tanstack-start',
]);

/**
 * Frontend framework types. Derived from {@link FrontendFrameworkSchema}.
 *
 * @example
 * ```ts
 * // Next.js app
 * {
 *   type: 'web',
 *   framework: 'nextjs',
 *   port: 3000,
 * }
 *
 * // Vite SPA
 * {
 *   type: 'web',
 *   framework: 'vite',
 *   port: 5173,
 * }
 *
 * // TanStack Start (Vite-based, full-stack)
 * {
 *   type: 'web',
 *   framework: 'tanstack-start',
 *   port: 3000,
 * }
 * ```
 */
export type FrontendFramework = z.infer<typeof FrontendFrameworkSchema>;

/**
 * Mobile framework schema.
 */
export const MobileFrameworkSchema = z.enum(['expo']);

/**
 * Mobile framework types. Derived from {@link MobileFrameworkSchema}.
 *
 * Mobile apps deploy via their own toolchain (e.g. EAS Build for Expo)
 * rather than Docker/Dokploy. Only build-time public env vars
 * (e.g. `EXPO_PUBLIC_*`) reach the device — server secrets are dropped.
 *
 * @example
 * ```ts
 * {
 *   type: 'mobile',
 *   framework: 'expo',
 *   path: 'apps/mobile',
 *   port: 8081,
 *   dependencies: ['api'],
 * }
 * ```
 */
export type MobileFramework = z.infer<typeof MobileFrameworkSchema>;

/**
 * Combined framework schema (backend, frontend, or mobile).
 */
export const FrameworkSchema = z.union([
	BackendFrameworkSchema,
	FrontendFrameworkSchema,
	MobileFrameworkSchema,
]);

/**
 * Any framework value across backend, frontend, or mobile.
 * Derived from {@link FrameworkSchema}.
 */
export type Framework = z.infer<typeof FrameworkSchema>;

/** Frontend framework values, kept in sync with FrontendFrameworkSchema. */
const FRONTEND_FRAMEWORKS = [
	'nextjs',
	'remix',
	'vite',
	'tanstack-start',
] as const;

/** Mobile framework values, kept in sync with MobileFrameworkSchema. */
const MOBILE_FRAMEWORKS = ['expo'] as const;

/**
 * A deploy target's name. Which names exist is the workspace's to say — the
 * built-ins and its own `deploy.targets` — so it is checked against both
 * once the whole config is read.
 */
const DeployTargetSchema = z.string().min(1);

/**
 * The built-in targets a config may name, both deployed by `gkm deploy`:
 * `dokploy`, and `sst`, which runs `sst deploy` on the manifest `gkm build`
 * writes.
 */
const SUPPORTED_DEPLOY_TARGETS = configurableBuiltins();

/** Built-in names reserved for targets that do not exist yet. */
const PHASE_2_DEPLOY_TARGETS = Object.entries(BUILTIN_TARGETS)
	.filter(([, target]) => target.status === 'planned')
	.map(([name]) => name);

/**
 * Whether a config may name `target`: a usable built-in, or one of its own
 * `deploy.targets`.
 */
export function isDeployTargetSupported(
	target: string,
	targets: Record<string, unknown> = {},
): boolean {
	return (
		SUPPORTED_DEPLOY_TARGETS.includes(target) || Object.hasOwn(targets, target)
	);
}

/**
 * Check if a deploy target is planned for Phase 2.
 */
export function isPhase2DeployTarget(target: string): boolean {
	return PHASE_2_DEPLOY_TARGETS.includes(target);
}

/**
 * Get error message for unsupported deploy targets.
 */
export function getDeployTargetError(target: string, appName?: string): string {
	if (isPhase2DeployTarget(target)) {
		const context = appName ? ` for app "${appName}"` : '';
		return `Deploy target "${target}"${context} is coming in Phase 2. Currently "dokploy" and "sst" are supported.`;
	}
	return `Unknown deploy target: ${target}. Built in: ${SUPPORTED_DEPLOY_TARGETS.join(', ')}; any other is named in deploy.targets with the package that provides it. Coming in Phase 2: ${PHASE_2_DEPLOY_TARGETS.join(', ')}.`;
}

/**
 * One `deploy.targets` entry: a package name, a target object, or either
 * with options.
 */
const DeployTargetEntrySchema = z.union([
	z.string().min(1, 'A target package name cannot be empty'),
	z.custom((value) => isDeployTarget(value), {
		message:
			'Expected a package name, a target (defineTarget), or [package or target, options]',
	}),
	z.tuple([
		z.union([
			z.string().min(1),
			z.custom((value) => isDeployTarget(value), {
				message: 'Expected a package name or a target (defineTarget)',
			}),
		]),
		z.unknown(),
	]),
]);

/**
 * Dokploy workspace configuration schema.
 * Supports either a single endpoint or per-stage endpoints.
 */
const DokployWorkspaceConfigSchema = z
	.object({
		/** Single endpoint for all stages */
		endpoint: z.url('Dokploy endpoint must be a valid URL').optional(),
		/** Per-stage endpoints (stage name -> endpoint URL) */
		endpoints: z
			.record(z.string(), z.url('Endpoint must be a valid URL'))
			.optional(),
		registryId: z.string().optional(),
		/** Dokploy's own backup destination for the stage's Postgres. */
		backups: z.lazy(() => DokployBackupsConfigSchema).optional(),
		verify: z
			.object({
				deploymentTimeoutMs: z.number().int().positive().optional(),
				healthCheckPath: z
					.string()
					.startsWith('/', 'healthCheckPath must start with /')
					.optional(),
				healthyAfter: z.number().int().positive().optional(),
				intervalMs: z.number().int().positive().optional(),
				healthTimeoutMs: z.number().int().positive().optional(),
			})
			.optional(),
	})
	.refine((data) => data.endpoint || data.endpoints, {
		message: 'Either endpoint or endpoints must be provided',
	});

// =============================================================================
// AWS Regions (needed by DNS and State providers)
// =============================================================================

/**
 * Valid AWS regions.
 */
const AwsRegionSchema = z.enum([
	'us-east-1',
	'us-east-2',
	'us-west-1',
	'us-west-2',
	'af-south-1',
	'ap-east-1',
	'ap-south-1',
	'ap-south-2',
	'ap-southeast-1',
	'ap-southeast-2',
	'ap-southeast-3',
	'ap-southeast-4',
	'ap-northeast-1',
	'ap-northeast-2',
	'ap-northeast-3',
	'ca-central-1',
	'eu-central-1',
	'eu-central-2',
	'eu-west-1',
	'eu-west-2',
	'eu-west-3',
	'eu-south-1',
	'eu-south-2',
	'eu-north-1',
	'me-south-1',
	'me-central-1',
	'sa-east-1',
]);

// =============================================================================
// DNS Record Types (used by DnsProvider interface)
// =============================================================================

/**
 * DNS record types supported across providers.
 */
export const DnsRecordTypeSchema = z.enum([
	'A',
	'AAAA',
	'CNAME',
	'MX',
	'TXT',
	'NS',
	'SRV',
	'CAA',
]);

/**
 * A DNS record as returned by the provider.
 */
export const DnsRecordSchema = z.object({
	/** Subdomain name (e.g., 'api' for api.example.com, '@' for root) */
	name: z.string(),
	/** Record type */
	type: DnsRecordTypeSchema,
	/** TTL in seconds */
	ttl: z.number().int().positive(),
	/** Record values */
	values: z.array(z.string()),
});

/**
 * A DNS record to create or update.
 */
export const UpsertDnsRecordSchema = z.object({
	/** Subdomain name (e.g., 'api' for api.example.com, '@' for root) */
	name: z.string(),
	/** Record type */
	type: DnsRecordTypeSchema,
	/** TTL in seconds */
	ttl: z.number().int().positive(),
	/** Record value (IP address, hostname, etc.) */
	value: z.string(),
});

/**
 * Result of an upsert operation.
 */
export const UpsertResultSchema = z.object({
	/** The record that was upserted */
	record: UpsertDnsRecordSchema,
	/** Whether the record was created (true) or updated (false) */
	created: z.boolean(),
	/** Whether the record already existed with the same value */
	unchanged: z.boolean(),
});

// =============================================================================
// DNS Provider Configuration
// =============================================================================

/**
 * How a domain's hosts point at a compose stage's server: an A (and AAAA)
 * record each (`'a'`, the default), or one A record for `target` and a CNAME
 * to it for every other host but the apex. `target` is one name, or one per
 * stage; it must be under the domain.
 */
export const DnsRecordsModeSchema = z.union([
	z.literal('a'),
	z
		.object({
			mode: z.literal('cname'),
			target: z.union([z.string(), z.record(z.string(), z.string())]),
		})
		.strict(),
]);

/**
 * Hostinger DNS provider config (without domain - domain is the record key).
 */
export const HostingerDnsProviderSchema = z.object({
	provider: z.literal('hostinger'),
	/** How the hosts point at a compose stage's server — see {@link DnsRecordsModeSchema}. */
	records: DnsRecordsModeSchema.optional(),
	/** TTL in seconds (default: 300) */
	ttl: z.number().int().positive().optional(),
});

/**
 * Route53 DNS provider config (without domain - domain is the record key).
 */
export const Route53DnsProviderSchema = z.object({
	provider: z.literal('route53'),
	/** How the hosts point at a compose stage's server — see {@link DnsRecordsModeSchema}. */
	records: DnsRecordsModeSchema.optional(),
	/** AWS region (optional - uses AWS_REGION env var if not provided) */
	region: AwsRegionSchema.optional(),
	/** AWS profile name (optional - uses default credential chain if not provided) */
	profile: z.string().optional(),
	/** Hosted zone ID (optional - auto-detected from domain if not provided) */
	hostedZoneId: z.string().optional(),
	/** TTL in seconds (default: 300) */
	ttl: z.number().int().positive().optional(),
});

/**
 * GoDaddy DNS provider config (without domain - domain is the record key).
 *
 * Credentials: `GODADDY_API_TOKEN` (a Personal Access Token scoped to
 * `domains.dns:update`), else `gkm login --provider godaddy`. GoDaddy refuses
 * a TTL under 600 seconds.
 */
export const GoDaddyDnsProviderSchema = z.object({
	provider: z.literal('godaddy'),
	/** How the hosts point at a compose stage's server — see {@link DnsRecordsModeSchema}. */
	records: DnsRecordsModeSchema.optional(),
	/** TTL in seconds (default and minimum: 600) */
	ttl: z
		.number()
		.int()
		.min(600, "GoDaddy's minimum TTL is 600 seconds")
		.optional(),
});

/**
 * Cloudflare DNS provider config (placeholder for future).
 */
export const CloudflareDnsProviderSchema = z.object({
	provider: z.literal('cloudflare'),
	/** How the hosts point at a compose stage's server — see {@link DnsRecordsModeSchema}. */
	records: DnsRecordsModeSchema.optional(),
	/** TTL in seconds (default: 300) */
	ttl: z.number().int().positive().optional(),
});

/**
 * Manual DNS configuration (user handles DNS themselves).
 */
export const ManualDnsProviderSchema = z.object({
	provider: z.literal('manual'),
	/** How the hosts point at a compose stage's server — see {@link DnsRecordsModeSchema}. */
	records: DnsRecordsModeSchema.optional(),
});

/**
 * Custom DNS provider config (user-provided implementation).
 */
export const CustomDnsProviderSchema = z.object({
	/** Custom DnsProvider implementation */
	provider: z.custom<{
		name: string;
		getRecords: Function;
		upsertRecords: Function;
	}>(
		(val) =>
			typeof val === 'object' &&
			val !== null &&
			typeof (val as any).name === 'string' &&
			typeof (val as any).getRecords === 'function' &&
			typeof (val as any).upsertRecords === 'function',
		{
			message:
				'Custom DNS provider must implement name, getRecords(), and upsertRecords() methods',
		},
	),
	/** How the hosts point at a compose stage's server — see {@link DnsRecordsModeSchema}. */
	records: DnsRecordsModeSchema.optional(),
	/** TTL in seconds (default: 300) */
	ttl: z.number().int().positive().optional(),
});

/**
 * Built-in DNS provider config (discriminated union).
 */
export const BuiltInDnsProviderSchema = z.discriminatedUnion('provider', [
	HostingerDnsProviderSchema,
	Route53DnsProviderSchema,
	GoDaddyDnsProviderSchema,
	CloudflareDnsProviderSchema,
	ManualDnsProviderSchema,
]);

/**
 * Single DNS provider config (for one domain).
 */
export const DnsProviderSchema = z.union([
	BuiltInDnsProviderSchema,
	CustomDnsProviderSchema,
]);

export type DnsProvider = z.infer<typeof DnsProviderSchema>;

/**
 * DNS configuration schema.
 *
 * Maps root domains to their DNS provider configuration.
 * Example:
 * ```
 * dns: {
 *   'geekmidas.dev': { provider: 'hostinger' },
 *   'geekmidas.com': { provider: 'route53' },
 * }
 * ```
 *
 * Supported providers:
 * - 'hostinger': Use Hostinger DNS API
 * - 'route53': Use AWS Route53
 * - 'godaddy': Use GoDaddy's v1 DNS API
 * - 'cloudflare': Use Cloudflare DNS API (future)
 * - 'manual': Don't create records, just print required records
 * - Custom: Provide a DnsProvider implementation
 */
export const DnsConfigSchema = z.record(z.string(), DnsProviderSchema);

// Legacy single-domain config schemas (for backwards compatibility)
export const HostingerDnsConfigSchema = HostingerDnsProviderSchema.extend({
	domain: z.string().min(1, 'Domain is required'),
});
export const Route53DnsConfigSchema = Route53DnsProviderSchema.extend({
	domain: z.string().min(1, 'Domain is required'),
});
export const GoDaddyDnsConfigSchema = GoDaddyDnsProviderSchema.extend({
	domain: z.string().min(1, 'Domain is required'),
});
export const CloudflareDnsConfigSchema = CloudflareDnsProviderSchema.extend({
	domain: z.string().min(1, 'Domain is required'),
});
export const ManualDnsConfigSchema = ManualDnsProviderSchema.extend({
	domain: z.string().min(1, 'Domain is required'),
});
export const CustomDnsConfigSchema = CustomDnsProviderSchema.extend({
	domain: z.string().min(1, 'Domain is required'),
});
export const BuiltInDnsConfigSchema = z.discriminatedUnion('provider', [
	HostingerDnsConfigSchema,
	Route53DnsConfigSchema,
	GoDaddyDnsConfigSchema,
	CloudflareDnsConfigSchema,
	ManualDnsConfigSchema,
]);
export const LegacyDnsConfigSchema = z.union([
	BuiltInDnsConfigSchema,
	CustomDnsConfigSchema,
]);

/**
 * Combined DNS config that supports both new multi-domain and legacy single-domain formats.
 */
export const DnsConfigWithLegacySchema = z.union([
	DnsConfigSchema,
	LegacyDnsConfigSchema,
]);

export type DnsConfig = z.infer<typeof DnsConfigWithLegacySchema>;

/**
 * Backups configuration schema.
 *
 * Configures automatic backup destinations for database services.
 * On first deploy, creates S3 bucket with unique name and IAM credentials.
 */
export const DokployBackupsConfigSchema = z.object({
	/** Backup storage type (currently only 's3' supported) */
	type: z.literal('s3'),
	/** AWS profile name for creating bucket/IAM resources */
	profile: z.string().optional(),
	/** AWS region for the backup bucket */
	region: AwsRegionSchema,
	/** Cron schedule for backups (default: '0 2 * * *' = 2 AM daily) */
	schedule: z.string().optional(),
	/** Number of backups to retain (default: 30) */
	retention: z.number().optional(),
});

export type DokployBackupsConfig = z.infer<typeof DokployBackupsConfigSchema>;

/**
 * `deploy.backups` — when each deployed compose stage's databases are backed
 * up, and how long a backup is kept. The rules are `checkStageBackups`', so
 * the schema and a deploy refuse the same entries with the same words.
 */
const BackupsConfigSchema = z
	.record(z.string(), z.unknown())
	.superRefine((entries, ctx) => {
		for (const [stage, value] of Object.entries(entries)) {
			try {
				checkStageBackups(stage, value);
			} catch (error) {
				ctx.addIssue({
					code: 'custom',
					message: error instanceof Error ? error.message : String(error),
					path: [stage],
				});
			}
		}
	});

/** `deploy.compose` — what the compose target runs beside the apps. */
const ComposeWorkspaceConfigSchema = z
	.object({
		proxy: z
			.union([
				z.enum(['caddy', 'traefik']),
				z.record(z.string(), z.enum(['caddy', 'traefik'])),
			])
			.optional(),
		tls: z
			.record(
				z.string(),
				z
					.object({ certFile: z.string().min(1), keyFile: z.string().min(1) })
					.strict(),
			)
			.optional(),
		server: z
			.record(
				z.string(),
				z
					.object({
						user: z.string().min(1),
						host: z.string().min(1).optional(),
						port: z.number().int().min(1).max(65_535).optional(),
					})
					.strict(),
			)
			.optional(),
	})
	// Strict, so a key it no longer takes — `logs`, now a `Telemetry`
	// construct and `deploy.telemetry` — fails to load rather than being
	// dropped without a word.
	.strict();

const TelemetrySampleRate = z.number().optional();

/**
 * `deploy.telemetry` — where each stage's telemetry goes. The rules past the
 * shape are `checkStageTelemetry`'s, so the schema and a deploy refuse the
 * same configs with the same words.
 */
const TelemetryConfigSchema = z
	.record(
		z.string(),
		z.union([
			z.literal(false),
			z.literal('self-hosted'),
			z
				.object({
					provider: z.literal('self-hosted'),
					port: z.number().optional(),
					retentionDays: z.number().optional(),
					public: z.object({ allow: z.array(z.string()) }).optional(),
					sampleRate: TelemetrySampleRate,
				})
				.strict(),
			z
				.object({
					provider: z.literal('otlp'),
					endpoint: z.string(),
					headers: z.record(z.string(), z.string()).optional(),
					sampleRate: TelemetrySampleRate,
				})
				.strict(),
		]),
	)
	.superRefine((telemetry, ctx) => {
		for (const [stage, config] of Object.entries(telemetry)) {
			try {
				checkStageTelemetry(stage, config);
			} catch (error) {
				ctx.addIssue({
					code: 'custom',
					message: error instanceof Error ? error.message : String(error),
					path: [stage],
				});
			}
		}
	});

/**
 * `deploy.objects` — what backs each deployed stage's buckets. The rules are
 * `checkStageProvider`'s, so the schema and a provision run refuse the same
 * entries with the same words.
 */
const ObjectsConfigSchema = z
	.record(z.string(), z.unknown())
	.superRefine((entries, ctx) => {
		for (const [stage, value] of Object.entries(entries)) {
			try {
				checkStageProvider('objects', stage, value);
			} catch (error) {
				ctx.addIssue({
					code: 'custom',
					message: error instanceof Error ? error.message : String(error),
					path: [stage],
				});
			}
		}
	});

/**
 * Deploy configuration schema.
 */
const DeployConfigSchema = z.object({
	default: DeployTargetSchema.optional(),
	targets: z
		.record(z.string(), DeployTargetEntrySchema)
		.superRefine((targets, ctx) => {
			for (const name of Object.keys(targets)) {
				// The built-ins resolve first, so an entry under one of their
				// names would never be used — say so rather than ignore it.
				if (builtinTarget(name)) {
					ctx.addIssue({
						code: 'custom',
						message: `"${name}" is a built-in target; give this one a name of its own`,
						path: [name],
					});
				}
			}
		})
		.optional(),
	/** Whose deploy this is, on a target shared with other workspaces. */
	namespace: z
		.string()
		.regex(
			/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
			"deploy.namespace must be lowercase letters and digits with single '-' between them",
		)
		.optional(),
	/** Where every target pushes and pulls the apps' images. */
	registry: z.string().min(1).optional(),
	dokploy: DokployWorkspaceConfigSchema.optional(),
	compose: ComposeWorkspaceConfigSchema.optional(),
	telemetry: TelemetryConfigSchema.optional(),
	objects: ObjectsConfigSchema.optional(),
	backups: BackupsConfigSchema.optional(),
});

/**
 * Models configuration schema.
 */
const ModelsConfigSchema = z.object({
	path: z.string().optional(),
	schema: z.enum(['zod']).optional(),
});

/**
 * Shared configuration schema.
 */
const SharedConfigSchema = z.object({
	packages: z.array(z.string()).optional(),
	models: ModelsConfigSchema.optional(),
});

/**
 * Secrets configuration schema.
 */
const StagesConfigSchema = z
	.object({
		local: z.string(),
		deployed: z.array(z.string()),
		protected: z.array(z.string()).optional(),
	})
	.superRefine((stages, ctx) => {
		for (const message of stageProblems(stages)) {
			ctx.addIssue({ code: 'custom', message });
		}
	});

const SecretsStoreSchema = z.union([
	z.literal('file'),
	z
		.object({
			provider: z.literal('s3'),
			/** A bucket that exists; omitted, the project bucket. */
			bucket: z.string().min(1).optional(),
			/** Omitted, the S3 deploy state's region. */
			region: AwsRegionSchema.optional(),
			/** Omitted, the S3 deploy state's prefix, else 'gkm'. */
			prefix: z.string().optional(),
		})
		.strict(),
	z.object({ provider: z.literal('ssm'), region: AwsRegionSchema }).strict(),
	z
		.object({
			provider: z.literal('secrets-manager'),
			region: AwsRegionSchema,
			kmsKeyId: z.string().min(1).optional(),
		})
		.strict(),
	z.object({
		/** Any backend: an object implementing SecretsStore */
		provider: z.custom<{ name: string; read: Function; write: Function }>(
			(val) =>
				typeof val === 'object' &&
				val !== null &&
				typeof (val as any).name === 'string' &&
				typeof (val as any).read === 'function' &&
				typeof (val as any).write === 'function',
			{ message: 'a secrets store has a name, read() and write()' },
		),
	}),
]);

const SecretsConfigSchema = z.object({
	enabled: z.boolean().optional(),
	store: SecretsStoreSchema.optional(),
	algorithm: z.string().optional(),
	kdf: z.enum(['scrypt', 'pbkdf2']).optional(),
});

// =============================================================================
// State Provider Configuration
// =============================================================================

/**
 * Local state provider config.
 */
const LocalStateConfigSchema = z.object({
	provider: z.literal('local'),
});

/**
 * SSM state provider config (requires region).
 */
const SSMStateConfigSchema = z.object({
	provider: z.literal('ssm'),
	/** AWS region (required for SSM provider) */
	region: AwsRegionSchema,
	/** AWS profile name (optional - uses default credential chain if not provided) */
	profile: z.string().optional(),
});

/**
 * S3 state provider config: conditional writes and a lock object in a bucket.
 */
const S3StateConfigSchema = z.object({
	provider: z.literal('s3'),
	/**
	 * Bucket the state lives in (must already exist). Omitted, the project
	 * bucket, created by the first deploy.
	 */
	bucket: z.string().min(1).optional(),
	/** AWS region of the bucket */
	region: AwsRegionSchema,
	/** Key prefix inside the bucket (default: 'gkm') */
	prefix: z.string().optional(),
	/** AWS profile name (optional - uses default credential chain if not provided) */
	profile: z.string().optional(),
});

/**
 * Custom state provider config (user-provided implementation).
 */
const CustomStateConfigSchema = z.object({
	/** Custom StateProvider implementation */
	provider: z.custom<{ read: Function; write: Function }>(
		(val) =>
			typeof val === 'object' &&
			val !== null &&
			typeof (val as any).read === 'function' &&
			typeof (val as any).write === 'function',
		{ message: 'Custom provider must implement read() and write() methods' },
	),
});

/**
 * Built-in state provider config (discriminated union).
 */
const BuiltInStateConfigSchema = z.discriminatedUnion('provider', [
	LocalStateConfigSchema,
	SSMStateConfigSchema,
	S3StateConfigSchema,
]);

/**
 * State configuration schema.
 *
 * Configures how deployment state is stored.
 * - 'local': Store in .gkm/deploy-{stage}.json (default)
 * - 'ssm': Store in AWS SSM Parameter Store (requires region)
 * - 's3': Store in an S3 bucket with conditional writes (requires region; the
 *   project bucket is created when no bucket is named)
 * - Custom: Provide a StateStore, or a StateProvider with read/write methods
 */
const StateConfigSchema = z.union([
	BuiltInStateConfigSchema,
	CustomStateConfigSchema,
]);

/**
 * App configuration schema.
 */
const AppConfigSchema = z
	.object({
		// Core properties
		type: z.enum(['backend', 'web', 'mobile']).optional().default('backend'),
		path: z.string().min(1, 'App path is required'),
		port: z.number().int().positive('Port must be a positive integer'),
		dependencies: z.array(z.string()).optional(),
		deploy: DeployTargetSchema.optional(),

		// Backend-specific (from GkmConfig)
		constructs: RoutesSchema.optional(),
		routes: RoutesSchema.optional(),
		functions: RoutesSchema.optional(),
		crons: RoutesSchema.optional(),
		queues: RoutesSchema.optional(),
		topics: RoutesSchema.optional(),
		subscribers: RoutesSchema.optional(),
		envParser: z.string().optional(),
		logger: z.string().optional(),
		hooks: HooksConfigSchema.optional(),
		telescope: z
			.union([z.string(), z.boolean(), TelescopeConfigSchema])
			.optional(),
		openapi: z.union([z.boolean(), OpenApiConfigSchema]).optional(),
		runtime: z.enum(['node', 'bun']).optional(),
		env: z.union([z.string(), z.array(z.string())]).optional(),

		// Entry point for non-gkm apps (used by dev and docker build)
		entry: z.string().optional(),

		// Framework (backend, web, or mobile)
		framework: FrameworkSchema.optional(),
		// Web/mobile: config file paths for env sniffing (calls .parse() at import)
		config: z
			.object({
				client: z.string().optional(),
				server: z.string().optional(),
			})
			.optional(),
	})
	// Note: routes is optional for backend apps - some backends like auth servers don't use routes
	.refine(
		(data) => {
			// Web apps must have a web framework
			if (data.type === 'web') {
				if (
					!data.framework ||
					!(FRONTEND_FRAMEWORKS as readonly string[]).includes(data.framework)
				) {
					return false;
				}
			}
			return true;
		},
		{
			message: `Web apps must have a valid web framework (${FRONTEND_FRAMEWORKS.join(', ')})`,
			path: ['framework'],
		},
	)
	.refine(
		(data) => {
			// Mobile apps must have a mobile framework
			if (data.type === 'mobile') {
				if (
					!data.framework ||
					!(MOBILE_FRAMEWORKS as readonly string[]).includes(data.framework)
				) {
					return false;
				}
			}
			return true;
		},
		{
			message: `Mobile apps must have a valid mobile framework (${MOBILE_FRAMEWORKS.join(', ')})`,
			path: ['framework'],
		},
	);

/** What `gkm test` hands a feature test. */
const TestConfigSchema = z
	.object({
		/** The folder of per-database factories; `test/factories` by default. */
		factories: z.string().optional(),
	})
	.strict();

/** How `gkm dev` is reached from outside the apps it runs. */
const DevConfigSchema = z
	.object({
		/** Browser origins that may read the discovery endpoint. */
		allowedOrigins: z
			.array(
				z.url().refine(
					// Checked even when `z.url()` has already failed it.
					(value) => URL.canParse(value) && new URL(value).origin === value,
					{
						message:
							'An origin is a scheme, host and port only, e.g. https://console.example.com — no path or trailing slash',
					},
				),
			)
			.optional(),
		/** The discovery endpoint's loopback port; 4983 by default. */
		discoveryPort: z.number().int().min(0).max(65535).optional(),
	})
	.strict();

/**
 * Workspace configuration schema.
 */
export const WorkspaceConfigSchema = z
	.object({
		name: z.string().optional(),
		/**
		 * Where the workspace's own constructs live, relative to its root.
		 *
		 * Infrastructure is a fact about the product, not about the process that
		 * happens to import it — so a database two apps share is declared once,
		 * at the top, and both find it. An app-level glob still works and is
		 * additive, for something only one app uses.
		 */
		constructs: RoutesSchema.optional(),
		/**
		 * Apps that nothing declares.
		 *
		 * Optional, and normally absent: a `site` is an app and so is a
		 * `rest-api` that named one, so the list is read off the graph. This is
		 * the escape hatch for what no construct describes — a mobile app, a
		 * process someone runs by hand — and for overriding one field of a
		 * derived app without restating it.
		 */
		apps: z.record(z.string(), AppConfigSchema).optional(),
		shared: SharedConfigSchema.optional(),
		/** Each deployed stage's base domain (stage name -> domain). */
		domains: z.record(z.string(), z.string()).optional(),
		/** Each root domain's DNS provider, and how its hosts are pointed. */
		dns: DnsConfigSchema.optional(),
		deploy: DeployConfigSchema.optional(),
		stages: StagesConfigSchema,
		secrets: SecretsConfigSchema.optional(),
		state: StateConfigSchema.optional(),
		test: TestConfigSchema.optional(),
		dev: DevConfigSchema.optional(),
	})
	// Strict, so a key this schema no longer has fails instead of being
	// dropped: a leftover `services:` block is a question the config used to
	// answer, and silently ignoring it would hide that the answer moved.
	.strict()
	.refine(
		(data) => {
			// Validate dependencies reference existing apps
			const appNames = Object.keys(data.apps ?? {});
			for (const [appName, app] of Object.entries(data.apps ?? {})) {
				for (const dep of app.dependencies ?? []) {
					if (!appNames.includes(dep)) {
						return false;
					}
					// Prevent self-dependency
					if (dep === appName) {
						return false;
					}
				}
			}
			return true;
		},
		{
			message:
				'App dependencies must reference existing apps and cannot be self-referential',
		},
	)
	.refine(
		(data) => {
			// Check for circular dependencies
			const appNames = Object.keys(data.apps ?? {});
			const visited = new Set<string>();
			const recStack = new Set<string>();

			function hasCycle(app: string): boolean {
				if (recStack.has(app)) return true;
				if (visited.has(app)) return false;

				visited.add(app);
				recStack.add(app);

				const deps = data.apps?.[app]?.dependencies ?? [];
				for (const dep of deps) {
					if (hasCycle(dep)) return true;
				}

				recStack.delete(app);
				return false;
			}

			for (const app of appNames) {
				visited.clear();
				recStack.clear();
				if (hasCycle(app)) return false;
			}
			return true;
		},
		{
			message: 'Circular dependencies detected between apps',
		},
	)
	.superRefine((data, ctx) => {
		// Validate deploy targets are supported
		const defaultTarget = data.deploy?.default;
		const ownTargets = data.deploy?.targets ?? {};
		if (defaultTarget && !isDeployTargetSupported(defaultTarget, ownTargets)) {
			ctx.addIssue({
				code: 'custom',
				message: getDeployTargetError(defaultTarget),
				path: ['deploy', 'default'],
			});
			return;
		}

		for (const [appName, app] of Object.entries(data.apps ?? {})) {
			if (app.deploy && !isDeployTargetSupported(app.deploy, ownTargets)) {
				ctx.addIssue({
					code: 'custom',
					message: getDeployTargetError(app.deploy, appName),
					path: ['apps', appName, 'deploy'],
				});
				return;
			}
		}

		// An s3 secrets store takes its region from the S3 state, or names one.
		const store = data.secrets?.store;
		if (typeof store === 'object' && store.provider === 's3') {
			try {
				s3SecretsLocation(store, data.state);
			} catch (error) {
				ctx.addIssue({
					code: 'custom',
					message: error instanceof Error ? error.message : String(error),
					path: ['secrets', 'store'],
				});
			}
		}

		// The compose target's per-stage settings name stages this workspace has.
		try {
			checkComposeStages(data.deploy?.compose, data.stages);
		} catch (error) {
			ctx.addIssue({
				code: 'custom',
				message: error instanceof Error ? error.message : String(error),
				path: ['deploy', 'compose'],
			});
		}

		// Every other per-stage map names deployed stages only.
		const perStage: [string, (string | number)[], unknown][] = [
			['domains', ['domains'], data.domains],
			['deploy.objects', ['deploy', 'objects'], data.deploy?.objects],
			['deploy.backups', ['deploy', 'backups'], data.deploy?.backups],
			['deploy.telemetry', ['deploy', 'telemetry'], data.deploy?.telemetry],
			...Object.entries(data.dns ?? {}).map(
				([domain, entry]): [string, (string | number)[], unknown] => {
					const records = (entry as { records?: unknown }).records;
					const target =
						records && typeof records === 'object'
							? (records as { target?: unknown }).target
							: undefined;
					return [
						`dns['${domain}'].records.target`,
						['dns', domain, 'records', 'target'],
						target && typeof target === 'object' ? target : undefined,
					];
				},
			),
		];
		for (const [setting, path, map] of perStage) {
			try {
				assertDeployedStageKeys(
					setting,
					map as Record<string, unknown> | undefined,
					data.stages,
				);
			} catch (error) {
				ctx.addIssue({
					code: 'custom',
					message: error instanceof Error ? error.message : String(error),
					path,
				});
			}
		}

		// A CNAME target is a hostname under its own domain.
		for (const [domain, entry] of Object.entries(data.dns ?? {})) {
			try {
				checkDnsRecordsMode(domain, (entry as { records?: unknown }).records);
			} catch (error) {
				ctx.addIssue({
					code: 'custom',
					message: error instanceof Error ? error.message : String(error),
					path: ['dns', domain, 'records'],
				});
			}
		}

		// Validate workspace name is required for SSM state provider
		if (data.state?.provider === 'ssm' && !data.name) {
			ctx.addIssue({
				code: 'custom',
				message:
					'Workspace name is required when using SSM state provider. Add "name" to your gkm.config.ts.',
				path: ['name'],
			});
		}
	});

/**
 * Validate workspace configuration.
 * Throws ZodError with detailed messages on validation failure.
 */
export function validateWorkspaceConfig(
	config: unknown,
): z.infer<typeof WorkspaceConfigSchema> {
	return WorkspaceConfigSchema.parse(config);
}

/**
 * Safe validation that returns result instead of throwing.
 */
export function safeValidateWorkspaceConfig(config: unknown): {
	success: boolean;
	data?: z.infer<typeof WorkspaceConfigSchema>;
	error?: z.ZodError;
} {
	const result = WorkspaceConfigSchema.safeParse(config);
	if (result.success) {
		return { success: true, data: result.data };
	}
	return { success: false, error: result.error };
}

/**
 * Format Zod errors into user-friendly messages.
 */
export function formatValidationErrors(error: z.ZodError): string {
	const messages = error.issues.map((issue: z.core.$ZodIssue) => {
		const path = issue.path.join('.');
		return path ? `  - ${path}: ${issue.message}` : `  - ${issue.message}`;
	});

	return `Workspace configuration validation failed:\n${messages.join('\n')}`;
}

export type ValidatedWorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export { SUPPORTED_DEPLOY_TARGETS, PHASE_2_DEPLOY_TARGETS };
