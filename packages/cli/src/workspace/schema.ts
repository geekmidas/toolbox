import { z } from 'zod/v4';

/**
 * Routes can be a string glob or array of globs.
 */
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
 * Studio configuration schema.
 */
const StudioConfigSchema = z.object({
	enabled: z.boolean().optional(),
	path: z.string().optional(),
	schema: z.string().optional(),
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
 * Client generation configuration schema.
 */
const ClientConfigSchema = z.object({
	output: z.string().optional(),
});

/**
 * Auth provider schema.
 * Currently only 'better-auth' is supported.
 */
const AuthProviderSchema = z.enum(['better-auth']);

/**
 * Backend framework schema for non-gkm apps.
 */
const BackendFrameworkSchema = z.enum([
	'hono',
	'better-auth',
	'express',
	'fastify',
]);

/**
 * Frontend framework schema.
 */
const FrontendFrameworkSchema = z.enum(['nextjs', 'remix', 'vite']);

/**
 * Combined framework schema (backend or frontend).
 */
const FrameworkSchema = z.union([
	BackendFrameworkSchema,
	FrontendFrameworkSchema,
]);

/**
 * Deploy target schema.
 * Currently only 'dokploy' is supported.
 * 'vercel' and 'cloudflare' are planned for Phase 2.
 */
const DeployTargetSchema = z.enum(['dokploy', 'vercel', 'cloudflare']);

/**
 * Supported deploy targets (Phase 1).
 */
const SUPPORTED_DEPLOY_TARGETS = ['dokploy'] as const;

/**
 * Phase 2 deploy targets (not yet implemented).
 */
const PHASE_2_DEPLOY_TARGETS = ['vercel', 'cloudflare'] as const;

/**
 * Check if a deploy target is supported.
 */
export function isDeployTargetSupported(target: string): boolean {
	return SUPPORTED_DEPLOY_TARGETS.includes(
		target as (typeof SUPPORTED_DEPLOY_TARGETS)[number],
	);
}

/**
 * Check if a deploy target is planned for Phase 2.
 */
export function isPhase2DeployTarget(target: string): boolean {
	return PHASE_2_DEPLOY_TARGETS.includes(
		target as (typeof PHASE_2_DEPLOY_TARGETS)[number],
	);
}

/**
 * Get error message for unsupported deploy targets.
 */
export function getDeployTargetError(target: string, appName?: string): string {
	if (isPhase2DeployTarget(target)) {
		const context = appName ? ` for app "${appName}"` : '';
		return `Deploy target "${target}"${context} is coming in Phase 2. Currently only "dokploy" is supported.`;
	}
	return `Unknown deploy target: ${target}. Supported: dokploy. Coming in Phase 2: vercel, cloudflare.`;
}

/**
 * Service image configuration schema.
 */
const ServiceImageConfigSchema = z.object({
	version: z.string().optional(),
	image: z.string().optional(),
});

/**
 * Mail service configuration schema.
 */
const MailServiceConfigSchema = ServiceImageConfigSchema.extend({
	smtp: z
		.object({
			host: z.string(),
			port: z.number(),
			user: z.string().optional(),
			pass: z.string().optional(),
		})
		.optional(),
});

/**
 * Services configuration schema.
 */
const ServicesConfigSchema = z.object({
	db: z.union([z.boolean(), ServiceImageConfigSchema]).optional(),
	cache: z.union([z.boolean(), ServiceImageConfigSchema]).optional(),
	mail: z.union([z.boolean(), MailServiceConfigSchema]).optional(),
});

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
		registry: z.string().optional(),
		registryId: z.string().optional(),
		/** Per-stage domain configuration (stage name -> base domain) */
		domains: z.record(z.string(), z.string()).optional(),
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
 * Hostinger DNS provider config (without domain - domain is the record key).
 */
export const HostingerDnsProviderSchema = z.object({
	provider: z.literal('hostinger'),
	/** TTL in seconds (default: 300) */
	ttl: z.number().int().positive().optional(),
});

/**
 * Route53 DNS provider config (without domain - domain is the record key).
 */
export const Route53DnsProviderSchema = z.object({
	provider: z.literal('route53'),
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
 * Cloudflare DNS provider config (placeholder for future).
 */
export const CloudflareDnsProviderSchema = z.object({
	provider: z.literal('cloudflare'),
	/** TTL in seconds (default: 300) */
	ttl: z.number().int().positive().optional(),
});

/**
 * Manual DNS configuration (user handles DNS themselves).
 */
export const ManualDnsProviderSchema = z.object({
	provider: z.literal('manual'),
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
	/** TTL in seconds (default: 300) */
	ttl: z.number().int().positive().optional(),
});

/**
 * Built-in DNS provider config (discriminated union).
 */
export const BuiltInDnsProviderSchema = z.discriminatedUnion('provider', [
	HostingerDnsProviderSchema,
	Route53DnsProviderSchema,
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
export const BackupsConfigSchema = z.object({
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

export type BackupsConfig = z.infer<typeof BackupsConfigSchema>;

/**
 * Deploy configuration schema.
 */
const DeployConfigSchema = z.object({
	default: DeployTargetSchema.optional(),
	dokploy: DokployWorkspaceConfigSchema.optional(),
	dns: DnsConfigWithLegacySchema.optional(),
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
const SecretsConfigSchema = z.object({
	enabled: z.boolean().optional(),
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
]);

/**
 * State configuration schema.
 *
 * Configures how deployment state is stored.
 * - 'local': Store in .gkm/deploy-{stage}.json (default)
 * - 'ssm': Store in AWS SSM Parameter Store (requires region)
 * - Custom: Provide a StateProvider implementation with read/write methods
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
		type: z.enum(['backend', 'frontend', 'auth']).optional().default('backend'),
		path: z.string().min(1, 'App path is required'),
		port: z.number().int().positive('Port must be a positive integer'),
		dependencies: z.array(z.string()).optional(),
		deploy: DeployTargetSchema.optional(),

		// Backend-specific (from GkmConfig)
		routes: RoutesSchema.optional(),
		functions: RoutesSchema.optional(),
		crons: RoutesSchema.optional(),
		subscribers: RoutesSchema.optional(),
		envParser: z.string().optional(),
		logger: z.string().optional(),
		hooks: HooksConfigSchema.optional(),
		telescope: z
			.union([z.string(), z.boolean(), TelescopeConfigSchema])
			.optional(),
		studio: z.union([z.string(), z.boolean(), StudioConfigSchema]).optional(),
		openapi: z.union([z.boolean(), OpenApiConfigSchema]).optional(),
		runtime: z.enum(['node', 'bun']).optional(),
		env: z.union([z.string(), z.array(z.string())]).optional(),

		// Entry point for non-gkm apps (used by dev and docker build)
		entry: z.string().optional(),

		// Framework (backend or frontend)
		framework: FrameworkSchema.optional(),
		client: ClientConfigSchema.optional(),

		// Frontend-specific: config file paths for env sniffing (calls .parse() at import)
		config: z
			.object({
				client: z.string().optional(),
				server: z.string().optional(),
			})
			.optional(),

		// Auth-specific
		provider: AuthProviderSchema.optional(),
	})
	// Note: routes is optional for backend apps - some backends like auth servers don't use routes
	.refine(
		(data) => {
			// Frontend apps must have a frontend framework
			if (data.type === 'frontend') {
				const frontendFrameworks = ['nextjs', 'remix', 'vite'];
				if (!data.framework || !frontendFrameworks.includes(data.framework)) {
					return false;
				}
			}
			return true;
		},
		{
			message:
				'Frontend apps must have a valid frontend framework (nextjs, remix, vite)',
			path: ['framework'],
		},
	)
	.refine(
		(data) => {
			// Auth apps must have provider
			if (data.type === 'auth' && !data.provider) {
				return false;
			}
			return true;
		},
		{
			message: 'Auth apps must have provider defined',
			path: ['provider'],
		},
	);

/**
 * Workspace configuration schema.
 */
export const WorkspaceConfigSchema = z
	.object({
		name: z.string().optional(),
		apps: z
			.record(z.string(), AppConfigSchema)
			.refine((apps) => Object.keys(apps).length > 0, {
				message: 'At least one app must be defined',
			}),
		shared: SharedConfigSchema.optional(),
		deploy: DeployConfigSchema.optional(),
		services: ServicesConfigSchema.optional(),
		secrets: SecretsConfigSchema.optional(),
		state: StateConfigSchema.optional(),
	})
	.refine(
		(data) => {
			// Validate dependencies reference existing apps
			const appNames = Object.keys(data.apps);
			for (const [appName, app] of Object.entries(data.apps)) {
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
			const appNames = Object.keys(data.apps);
			const visited = new Set<string>();
			const recStack = new Set<string>();

			function hasCycle(app: string): boolean {
				if (recStack.has(app)) return true;
				if (visited.has(app)) return false;

				visited.add(app);
				recStack.add(app);

				const deps = data.apps[app]?.dependencies ?? [];
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
		if (defaultTarget && !isDeployTargetSupported(defaultTarget)) {
			ctx.addIssue({
				code: 'custom',
				message: getDeployTargetError(defaultTarget),
				path: ['deploy', 'default'],
			});
			return;
		}

		for (const [appName, app] of Object.entries(data.apps)) {
			if (app.deploy && !isDeployTargetSupported(app.deploy)) {
				ctx.addIssue({
					code: 'custom',
					message: getDeployTargetError(app.deploy, appName),
					path: ['apps', appName, 'deploy'],
				});
				return;
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
