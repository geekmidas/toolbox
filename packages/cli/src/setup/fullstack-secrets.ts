import { generateSecurePassword } from '../secrets/generator.js';
import type { NormalizedWorkspace } from '../workspace/types.js';

/**
 * Generate fullstack-aware custom secrets for a workspace.
 *
 * Generates:
 * - Common secrets: PORT, LOG_LEVEL, JWT_SECRET (no `NODE_ENV` — the command
 *   decides that; see `gkm init`)
 * - Better-auth secrets for apps using the better-auth framework
 *
 * No address of anything a construct declares — a database's or a tenant's
 * URL, a surface's or a site's. Those are derived from the construct, with
 * passwords from the stage, and one stored here would be a value set by hand,
 * which wins over the derived one: a `localhost` URL handed to a container,
 * with a password no role has.
 */
export function generateFullstackCustomSecrets(
	workspace: NormalizedWorkspace,
	containers: readonly string[] = [],
): Record<string, string> {
	// A Postgres exists because something declared a database, not because
	// config carried a flag saying so.
	const hasDb = containers.includes('postgres');
	const customs: Record<string, string> = {
		PORT: '3000',
		LOG_LEVEL: 'debug',
		JWT_SECRET: `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	};

	if (!hasDb) {
		return customs;
	}

	for (const appConfig of Object.values(workspace.apps)) {
		if (appConfig.type === 'web' || appConfig.type === 'mobile') continue;

		// Better-auth framework secrets
		if (appConfig.framework === 'better-auth') {
			customs.AUTH_PORT = String(appConfig.port);
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
