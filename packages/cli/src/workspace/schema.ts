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
	return SUPPORTED_DEPLOY_TARGETS.includes(target as typeof SUPPORTED_DEPLOY_TARGETS[number]);
}

/**
 * Check if a deploy target is planned for Phase 2.
 */
export function isPhase2DeployTarget(target: string): boolean {
	return PHASE_2_DEPLOY_TARGETS.includes(target as typeof PHASE_2_DEPLOY_TARGETS[number]);
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
 */
const DokployWorkspaceConfigSchema = z.object({
	endpoint: z.url('Dokploy endpoint must be a valid URL'),
	projectId: z.string().min(1, 'Project ID is required'),
	registry: z.string().optional(),
	registryId: z.string().optional(),
});

/**
 * Deploy configuration schema.
 */
const DeployConfigSchema = z.object({
	default: DeployTargetSchema.optional(),
	dokploy: DokployWorkspaceConfigSchema.optional(),
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

/**
 * App configuration schema.
 */
const AppConfigSchema = z
	.object({
		// Core properties
		type: z.enum(['backend', 'frontend']).optional().default('backend'),
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

		// Frontend-specific
		framework: z.enum(['nextjs']).optional(),
		client: ClientConfigSchema.optional(),
	})
	.refine(
		(data) => {
			// Backend apps must have routes
			if (data.type === 'backend' && !data.routes) {
				return false;
			}
			return true;
		},
		{
			message: 'Backend apps must have routes defined',
			path: ['routes'],
		},
	)
	.refine(
		(data) => {
			// Frontend apps must have framework
			if (data.type === 'frontend' && !data.framework) {
				return false;
			}
			return true;
		},
		{
			message: 'Frontend apps must have framework defined',
			path: ['framework'],
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
				code: z.ZodIssueCode.custom,
				message: getDeployTargetError(defaultTarget),
				path: ['deploy', 'default'],
			});
			return;
		}

		for (const [appName, app] of Object.entries(data.apps)) {
			if (app.deploy && !isDeployTargetSupported(app.deploy)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: getDeployTargetError(app.deploy, appName),
					path: ['apps', appName, 'deploy'],
				});
				return;
			}
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
