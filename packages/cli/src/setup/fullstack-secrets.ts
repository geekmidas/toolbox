import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { generateSecurePassword } from '../secrets/generator.js';
import type { StageSecrets } from '../secrets/types.js';
import type { NormalizedWorkspace } from '../workspace/types.js';

/**
 * Generate a secure random password for database users.
 * Uses a combination of timestamp and random bytes for uniqueness.
 */
export function generateDbPassword(): string {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * Generate database URL for an app.
 * All apps connect to the same database, but use different users/schemas.
 */
export function generateDbUrl(
	appName: string,
	password: string,
	projectName: string,
	host = 'localhost',
	port = 5432,
): string {
	const userName = appName.replace(/-/g, '_');
	const dbName = `${projectName.replace(/-/g, '_')}_dev`;
	return `postgresql://${userName}:${password}@${host}:${port}/${dbName}`;
}

/**
 * Generate fullstack-aware custom secrets for a workspace.
 *
 * Generates:
 * - Common secrets: NODE_ENV, PORT, LOG_LEVEL, JWT_SECRET
 * - Per-app database passwords and URLs for backend apps with db service
 * - Better-auth secrets for apps using the better-auth framework
 */
export function generateFullstackCustomSecrets(
	workspace: NormalizedWorkspace,
): Record<string, string> {
	const hasDb = !!workspace.services.db;
	const customs: Record<string, string> = {
		NODE_ENV: 'development',
		PORT: '3000',
		LOG_LEVEL: 'debug',
		JWT_SECRET: `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	};

	if (!hasDb) {
		return customs;
	}

	// Collect all frontend ports for trusted origins
	const frontendPorts: number[] = [];

	for (const [appName, appConfig] of Object.entries(workspace.apps)) {
		if (appConfig.type === 'frontend') {
			frontendPorts.push(appConfig.port);
			continue;
		}

		// Backend apps with database: generate per-app DB passwords and URLs
		const password = generateDbPassword();
		const upperName = appName.toUpperCase();

		customs[`${upperName}_DATABASE_URL`] = generateDbUrl(
			appName,
			password,
			workspace.name,
		);
		customs[`${upperName}_DB_PASSWORD`] = password;

		// Better-auth framework secrets
		if (appConfig.framework === 'better-auth') {
			customs.AUTH_PORT = String(appConfig.port);
			customs.AUTH_URL = `http://localhost:${appConfig.port}`;
			customs.BETTER_AUTH_SECRET = `better-auth-${Date.now()}-${generateSecurePassword(16)}`;
			customs.BETTER_AUTH_URL = `http://localhost:${appConfig.port}`;
		}
	}

	// Generate trusted origins for better-auth (all app ports)
	if (customs.BETTER_AUTH_SECRET) {
		const allPorts = Object.values(workspace.apps).map((a) => a.port);
		customs.BETTER_AUTH_TRUSTED_ORIGINS = allPorts
			.map((p) => `http://localhost:${p}`)
			.join(',');
	}

	return customs;
}

/**
 * Extract *_DB_PASSWORD keys from secrets and write docker/.env.
 *
 * The docker/.env file contains database passwords that the PostgreSQL
 * init script reads to create per-app database users.
 */
export async function writeDockerEnvFromSecrets(
	secrets: StageSecrets,
	workspaceRoot: string,
): Promise<void> {
	const dbPasswordEntries = Object.entries(secrets.custom).filter(([key]) =>
		key.endsWith('_DB_PASSWORD'),
	);

	if (dbPasswordEntries.length === 0) {
		return;
	}

	const envContent = `# Auto-generated docker environment file
# Contains database passwords for docker-compose postgres init
# This file is gitignored - do not commit to version control
${dbPasswordEntries.map(([key, value]) => `${key}=${value}`).join('\n')}
`;

	const envPath = join(workspaceRoot, 'docker', '.env');
	await mkdir(dirname(envPath), { recursive: true });
	await writeFile(envPath, envContent);
}
