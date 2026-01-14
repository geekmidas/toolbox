import type { GeneratedFile, TemplateOptions } from '../templates/index.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';

/**
 * Generate auth app files for fullstack template
 * Uses better-auth with magic link authentication
 */
export function generateAuthAppFiles(
	options: TemplateOptions,
): GeneratedFile[] {
	if (!options.monorepo || options.template !== 'fullstack') {
		return [];
	}

	const packageName = `@${options.name}/auth`;
	const modelsPackage = `@${options.name}/models`;

	// package.json for auth app
	const packageJson = {
		name: packageName,
		version: '0.0.1',
		private: true,
		type: 'module',
		scripts: {
			dev: 'tsx watch src/index.ts',
			build: 'tsc',
			start: 'node dist/index.js',
			typecheck: 'tsc --noEmit',
		},
		dependencies: {
			[modelsPackage]: 'workspace:*',
			'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
			'@geekmidas/logger': GEEKMIDAS_VERSIONS['@geekmidas/logger'],
			'@hono/node-server': '~1.13.0',
			'better-auth': '~1.2.0',
			hono: '~4.8.0',
			kysely: '~0.27.0',
			pg: '~8.13.0',
		},
		devDependencies: {
			'@types/node': '~22.0.0',
			'@types/pg': '~8.11.0',
			tsx: '~4.20.0',
			typescript: '~5.8.2',
		},
	};

	// tsconfig.json for auth app
	const tsConfig = {
		extends: '../../tsconfig.json',
		compilerOptions: {
			noEmit: true,
			baseUrl: '.',
			paths: {
				[`@${options.name}/*`]: ['../../packages/*/src'],
			},
		},
		include: ['src/**/*.ts'],
		exclude: ['node_modules', 'dist'],
	};

	// src/config/env.ts
	const envTs = `import { Credentials } from '@geekmidas/envkit/credentials';
import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser({ ...process.env, ...Credentials });

// Global config - only minimal shared values
// Service-specific config should be parsed where needed
export const config = envParser
  .create((get) => ({
    nodeEnv: get('NODE_ENV').enum(['development', 'test', 'production']).default('development'),
    stage: get('STAGE').enum(['development', 'staging', 'production']).default('development'),
  }))
  .parse();
`;

	// src/config/logger.ts
	const loggerTs = `import { createLogger } from '@geekmidas/logger/${options.loggerType}';

export const logger = createLogger();
`;

	// src/auth.ts - better-auth instance with magic link
	const authTs = `import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import pg from 'pg';
import { envParser } from './config/env.js';
import { logger } from './config/logger.js';

// Parse auth-specific config (no defaults - values from secrets)
const authConfig = envParser
  .create((get) => ({
    databaseUrl: get('DATABASE_URL').string(),
    baseUrl: get('BETTER_AUTH_URL').string(),
    trustedOrigins: get('BETTER_AUTH_TRUSTED_ORIGINS').string(),
    secret: get('BETTER_AUTH_SECRET').string(),
  }))
  .parse();

export const auth = betterAuth({
  database: new pg.Pool({
    connectionString: authConfig.databaseUrl,
  }),
  baseURL: authConfig.baseUrl,
  trustedOrigins: authConfig.trustedOrigins.split(','),
  secret: authConfig.secret,
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // TODO: Implement email sending using @geekmidas/emailkit
        // For development, log the magic link
        logger.info({ email, url }, 'Magic link generated');
        console.log('\\n================================');
        console.log('MAGIC LINK FOR:', email);
        console.log(url);
        console.log('================================\\n');
      },
      expiresIn: 300, // 5 minutes
    }),
  ],
  emailAndPassword: {
    enabled: false, // Only magic link for now
  },
});

export type Auth = typeof auth;
`;

	// src/index.ts - Hono app entry point
	const indexTs = `import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { auth } from './auth.js';
import { envParser } from './config/env.js';
import { logger } from './config/logger.js';

// Parse server config (no defaults - values from secrets)
const serverConfig = envParser
  .create((get) => ({
    port: get('PORT').string().transform(Number),
    trustedOrigins: get('BETTER_AUTH_TRUSTED_ORIGINS').string(),
  }))
  .parse();

const app = new Hono();

// CORS must be registered before routes
app.use(
  '/api/auth/*',
  cors({
    origin: serverConfig.trustedOrigins.split(','),
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    credentials: true,
  }),
);

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'auth',
    timestamp: new Date().toISOString(),
  });
});

// Mount better-auth handler
app.on(['POST', 'GET'], '/api/auth/*', (c) => {
  return auth.handler(c.req.raw);
});

logger.info({ port: serverConfig.port }, 'Starting auth server');

serve({
  fetch: app.fetch,
  port: serverConfig.port,
}, (info) => {
  logger.info({ port: info.port }, 'Auth server running');
});
`;

	// .gitignore for auth app
	const gitignore = `node_modules/
dist/
.env.local
*.log
`;

	return [
		{
			path: 'apps/auth/package.json',
			content: `${JSON.stringify(packageJson, null, 2)}\n`,
		},
		{
			path: 'apps/auth/tsconfig.json',
			content: `${JSON.stringify(tsConfig, null, 2)}\n`,
		},
		{
			path: 'apps/auth/src/config/env.ts',
			content: envTs,
		},
		{
			path: 'apps/auth/src/config/logger.ts',
			content: loggerTs,
		},
		{
			path: 'apps/auth/src/auth.ts',
			content: authTs,
		},
		{
			path: 'apps/auth/src/index.ts',
			content: indexTs,
		},
		{
			path: 'apps/auth/.gitignore',
			content: gitignore,
		},
	];
}
