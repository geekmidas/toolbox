/**
 * Environment Variable Resolution for Dokploy Deployments
 *
 * Resolves sniffed environment variables to actual values during deployment.
 * Auto-supports common variables like DATABASE_URL, REDIS_URL, BETTER_AUTH_*,
 * and falls back to user-provided secrets.
 */

import { randomBytes } from 'node:crypto';
import type { StageSecrets } from '../secrets/types';
import type { NormalizedAppConfig } from '../workspace/types';
import {
	type AppDbCredentials,
	type DokployStageState,
	getGeneratedSecret,
	setGeneratedSecret,
} from './state';

/**
 * Context needed for environment variable resolution
 */
export interface EnvResolverContext {
	/** The app being deployed */
	app: NormalizedAppConfig;
	/** The app name */
	appName: string;
	/** Deployment stage (production, staging, development) */
	stage: string;
	/** Deploy state (for persisting generated secrets) */
	state: DokployStageState;
	/** Per-app database credentials (if postgres is enabled) */
	appCredentials?: AppDbCredentials;
	/** Postgres connection info (internal hostname) */
	postgres?: {
		host: string;
		port: number;
		database: string;
	};
	/** Redis connection info (internal hostname) */
	redis?: {
		host: string;
		port: number;
		password?: string;
	};
	/** Public hostname for this app */
	appHostname: string;
	/** All frontend app URLs (for BETTER_AUTH_TRUSTED_ORIGINS) */
	frontendUrls: string[];
	/** User-provided secrets from secrets store */
	userSecrets?: StageSecrets;
	/** Master key for runtime decryption (optional) */
	masterKey?: string;
	/** URLs of deployed dependency apps (e.g., { auth: 'https://auth.example.com' }) */
	dependencyUrls?: Record<string, string>;
}

/**
 * Result of environment variable resolution
 */
export interface EnvResolutionResult {
	/** Successfully resolved environment variables */
	resolved: Record<string, string>;
	/** Environment variable names that could not be resolved */
	missing: string[];
}

/**
 * Auto-supported environment variable names
 */
export const AUTO_SUPPORTED_VARS = [
	'PORT',
	'NODE_ENV',
	'STAGE',
	'DATABASE_URL',
	'REDIS_URL',
	'BETTER_AUTH_URL',
	'BETTER_AUTH_SECRET',
	'BETTER_AUTH_TRUSTED_ORIGINS',
	'GKM_MASTER_KEY',
] as const;

export type AutoSupportedVar = (typeof AUTO_SUPPORTED_VARS)[number];

/**
 * Check if a variable name is auto-supported
 */
export function isAutoSupportedVar(
	varName: string,
): varName is AutoSupportedVar {
	return AUTO_SUPPORTED_VARS.includes(varName as AutoSupportedVar);
}

/**
 * Generate a secure random secret (64 hex characters = 32 bytes)
 */
export function generateSecret(): string {
	return randomBytes(32).toString('hex');
}

/**
 * Get or generate a secret for an app.
 * If the secret already exists in state, returns it.
 * Otherwise generates a new one and stores it.
 */
export function getOrGenerateSecret(
	state: DokployStageState,
	appName: string,
	secretName: string,
): string {
	// Check if already generated
	const existing = getGeneratedSecret(state, appName, secretName);
	if (existing) {
		return existing;
	}

	// Generate new secret
	const generated = generateSecret();

	// Store in state for persistence
	setGeneratedSecret(state, appName, secretName, generated);

	return generated;
}

/**
 * Build a DATABASE_URL for an app with per-app credentials
 */
export function buildDatabaseUrl(
	credentials: AppDbCredentials,
	postgres: { host: string; port: number; database: string },
): string {
	const { dbUser, dbPassword } = credentials;
	const { host, port, database } = postgres;
	return `postgresql://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@${host}:${port}/${database}`;
}

/**
 * Build a REDIS_URL
 */
export function buildRedisUrl(redis: {
	host: string;
	port: number;
	password?: string;
}): string {
	const { host, port, password } = redis;
	if (password) {
		return `redis://:${encodeURIComponent(password)}@${host}:${port}`;
	}
	return `redis://${host}:${port}`;
}

/**
 * Resolve a single environment variable
 */
export function resolveEnvVar(
	varName: string,
	context: EnvResolverContext,
): string | undefined {
	// Auto-supported variables
	switch (varName) {
		case 'PORT':
			return String(context.app.port);

		case 'NODE_ENV':
			// Always 'production' for deployed apps (gkm dev handles development mode)
			return 'production';

		case 'STAGE':
			return context.stage;

		case 'DATABASE_URL':
			if (context.appCredentials && context.postgres) {
				return buildDatabaseUrl(context.appCredentials, context.postgres);
			}
			// Fall through to check user secrets
			break;

		case 'REDIS_URL':
			if (context.redis) {
				return buildRedisUrl(context.redis);
			}
			// Fall through to check user secrets
			break;

		case 'BETTER_AUTH_URL':
			return `https://${context.appHostname}`;

		case 'BETTER_AUTH_SECRET':
			return getOrGenerateSecret(
				context.state,
				context.appName,
				'BETTER_AUTH_SECRET',
			);

		case 'BETTER_AUTH_TRUSTED_ORIGINS':
			if (context.frontendUrls.length > 0) {
				return context.frontendUrls.join(',');
			}
			// Fall through to check user secrets
			break;

		case 'GKM_MASTER_KEY':
			if (context.masterKey) {
				return context.masterKey;
			}
			// Fall through to check user secrets
			break;
	}

	// Check dependency URLs (e.g., AUTH_URL -> dependencyUrls.auth)
	if (context.dependencyUrls && varName.endsWith('_URL')) {
		const depName = varName.slice(0, -4).toLowerCase(); // AUTH_URL -> auth
		if (context.dependencyUrls[depName]) {
			return context.dependencyUrls[depName];
		}
	}

	// Check user-provided secrets
	if (context.userSecrets) {
		// Check custom secrets first
		if (context.userSecrets.custom[varName]) {
			return context.userSecrets.custom[varName];
		}

		// Check URLs (DATABASE_URL, REDIS_URL, RABBITMQ_URL)
		if (varName in context.userSecrets.urls) {
			return context.userSecrets.urls[
				varName as keyof typeof context.userSecrets.urls
			];
		}

		// Check service-specific vars
		if (
			varName === 'POSTGRES_PASSWORD' &&
			context.userSecrets.services.postgres
		) {
			return context.userSecrets.services.postgres.password;
		}
		if (varName === 'REDIS_PASSWORD' && context.userSecrets.services.redis) {
			return context.userSecrets.services.redis.password;
		}
	}

	return undefined;
}

/**
 * Resolve all environment variables for an app
 */
export function resolveEnvVars(
	requiredVars: string[],
	context: EnvResolverContext,
): EnvResolutionResult {
	const resolved: Record<string, string> = {};
	const missing: string[] = [];

	for (const varName of requiredVars) {
		const value = resolveEnvVar(varName, context);
		if (value !== undefined) {
			resolved[varName] = value;
		} else {
			missing.push(varName);
		}
	}

	return { resolved, missing };
}

/**
 * Format missing variables error message
 */
export function formatMissingVarsError(
	appName: string,
	missing: string[],
	stage: string,
): string {
	const varList = missing.map((v) => `  - ${v}`).join('\n');
	return (
		`Deployment failed: ${appName} is missing required environment variables:\n` +
		`${varList}\n\n` +
		`Add them with:\n` +
		`  gkm secrets:set <VAR_NAME> <value> --stage ${stage}\n\n` +
		`Or add them to the app's requiredEnv in gkm.config.ts to have them auto-resolved.`
	);
}

/**
 * Validate that all required environment variables can be resolved
 */
export function validateEnvVars(
	requiredVars: string[],
	context: EnvResolverContext,
): { valid: boolean; missing: string[]; resolved: Record<string, string> } {
	const { resolved, missing } = resolveEnvVars(requiredVars, context);
	return {
		valid: missing.length === 0,
		missing,
		resolved,
	};
}
