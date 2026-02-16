import { normalizeWorkspace } from '../../../workspace/index';

/**
 * Simulates the secrets that gkm init generates for a fullstack workspace.
 * In production these come from the encrypted store via toEmbeddableSecrets.
 */
export function createFullstackSecrets(): Record<string, string> {
	return {
		NODE_ENV: 'development',
		PORT: '3000',
		LOG_LEVEL: 'debug',
		JWT_SECRET: 'dev-jwt-secret',
		// Per-app database URLs (fullstack workspace)
		API_DATABASE_URL:
			'postgresql://api:api-pass@localhost:5432/my-saas',
		AUTH_DATABASE_URL:
			'postgresql://auth:auth-pass@localhost:5432/my-saas',
		API_DB_PASSWORD: 'api-pass',
		AUTH_DB_PASSWORD: 'auth-pass',
		// Auth service secrets
		AUTH_PORT: '3002',
		AUTH_URL: 'http://localhost:3002',
		BETTER_AUTH_SECRET: 'better-auth-secret-123',
		BETTER_AUTH_URL: 'http://localhost:3002',
		BETTER_AUTH_TRUSTED_ORIGINS:
			'http://localhost:3000,http://localhost:3001',
		// Service credentials
		POSTGRES_USER: 'api',
		POSTGRES_PASSWORD: 'api-pass',
		POSTGRES_DB: 'my-saas',
		POSTGRES_HOST: 'localhost',
		POSTGRES_PORT: '5432',
		REDIS_PASSWORD: 'redis-pass',
		REDIS_HOST: 'localhost',
		REDIS_PORT: '6379',
		// URLs
		DATABASE_URL: 'postgresql://api:api-pass@localhost:5432/my-saas',
		REDIS_URL: 'redis://:redis-pass@localhost:6379',
	};
}

export function createFullstackWorkspace(): ReturnType<
	typeof normalizeWorkspace
> {
	return normalizeWorkspace(
		{
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/endpoints/**/*.ts',
					dependencies: [],
				},
				auth: {
					type: 'backend',
					path: 'apps/auth',
					port: 3002,
					entry: './src/index.ts',
					dependencies: [],
				},
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3001,
					framework: 'nextjs',
					dependencies: ['api', 'auth'],
				},
			},
		},
		'/project',
	);
}

/**
 * Simulates what loadSecretsForApp does for a specific app:
 * maps {APP}_DATABASE_URL -> DATABASE_URL.
 */
export function mapSecretsForApp(
	secrets: Record<string, string>,
	appName: string,
): Record<string, string> {
	const prefix = appName.toUpperCase();
	const mapped = { ...secrets };
	const appDbUrl = secrets[`${prefix}_DATABASE_URL`];
	if (appDbUrl) {
		mapped.DATABASE_URL = appDbUrl;
	}
	return mapped;
}

export const COMPOSE_FULL = `
services:
  postgres:
    image: postgres:17
    ports:
      - '\${POSTGRES_HOST_PORT:-5432}:5432'
  redis:
    image: redis:7
    ports:
      - '\${REDIS_HOST_PORT:-6379}:6379'
  mailpit:
    image: axllent/mailpit
    ports:
      - '\${MAILPIT_SMTP_PORT:-1025}:1025'
      - '\${MAILPIT_UI_PORT:-8025}:8025'
`;
