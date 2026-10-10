import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { itWithDir } from '@geekmidas/testkit/os';
import { describe, expect, it, vi } from 'vitest';
import {
	createMockCronFile,
	createMockEndpointFile,
	createMockFunctionFile,
	createTestFile,
} from '../../__tests__/test-helpers';
import { normalizeWorkspace } from '../../workspace/index';
import { buildApp, buildCommand, writeManifest } from '../index';

/** The generated manifest, imported the way `sst.config.ts` imports it. */
async function readManifest(path: string) {
	const source = await readFile(path, 'utf-8');
	const module = await import(`${path}?t=${Date.now()}`);
	return {
		source,
		constructs: module.constructs as Record<string, any>,
		backends: module.backends as Record<string, string>,
	};
}

const ofKind = (constructs: Record<string, any>, kind: string) =>
	Object.values(constructs).filter((d) => d.kind === kind);

describe('buildCommand', () => {
	itWithDir(
		"builds a RestApi's production server without its worker's background work",
		async ({ dir }) => {
			await createMockEndpointFile(
				dir,
				'src/endpoints/users.ts',
				'getUsersEndpoint',
				'/users',
				'GET',
			);
			await createMockCronFile(
				dir,
				'src/crons/cleanup.ts',
				'cleanupCron',
				'rate(1 day)',
			);
			await createTestFile(
				dir,
				'gkm.config.ts',
				`
export default {
  stages: { local: 'development', deployed: ['production'] },
  constructs: './src/**/*.ts',
};
`,
			);
			const log = vi.spyOn(console, 'log').mockImplementation(() => {});
			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				await buildCommand({
					provider: 'server',
					production: true,
					skipBundle: true,
				});

				const app = await readFile(
					join(dir, '.gkm', 'server', 'app.ts'),
					'utf-8',
				);
				// The routes, and nothing that runs beside them.
				expect(app).toContain('await setupEndpoints(');
				expect(app).not.toContain('setupCrons');
				expect(app).not.toContain('setupQueues');
				expect(app).not.toContain('setupSubscribers');
				// Not dropped: the cron is the worker's, in the worker's entry.
				const serverCrons = await readFile(
					join(dir, '.gkm', 'server', 'crons.ts'),
					'utf-8',
				);
				expect(serverCrons).not.toContain('cleanupCron');
				const workerCrons = await readFile(
					join(dir, '.gkm', 'server', 'workers', 'jobs', 'crons.ts'),
					'utf-8',
				);
				expect(workerCrons).toContain('cleanupCron');
			} finally {
				process.chdir(originalCwd);
				log.mockRestore();
			}
		},
	);

	/** A server build of an app whose cache is declared from its database. */
	async function buildWithCache(
		dir: string,
		options: { cache?: 'redis' } = {},
	): Promise<string> {
		await createMockEndpointFile(
			dir,
			'src/endpoints/users.ts',
			'getUsersEndpoint',
			'/users',
			'GET',
		);
		await createTestFile(
			dir,
			'src/cache.ts',
			`import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';

export const database = new KyselyDatabase('Database');
export const sessions = database.cache('Sessions');
`,
		);
		// The process registers a cache driver because an endpoint it serves
		// reaches the cache.
		await createTestFile(
			dir,
			'src/endpoints/session.ts',
			`import { z } from 'zod';
import { sessions } from '../cache.js';
import { api } from '../constructs/api.js';

export const getSession = api
  .get('/session')
  .dependsOn([sessions])
  .output(z.object({ ok: z.boolean() }))
  .handle(async () => ({ ok: true }));
`,
		);
		await createTestFile(
			dir,
			'gkm.config.ts',
			`
export default {
  stages: { local: 'development', deployed: ['production'] },
  constructs: './src/**/*.ts',
};
`,
		);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const originalCwd = process.cwd();
		process.chdir(dir);
		try {
			await buildCommand({
				provider: 'server',
				production: true,
				skipBundle: true,
				...options,
			});
			return await readFile(join(dir, '.gkm', 'server', 'app.ts'), 'utf-8');
		} finally {
			process.chdir(originalCwd);
			log.mockRestore();
		}
	}

	itWithDir(
		'registers the Postgres driver for a cache declared from its database',
		async ({ dir }) => {
			const app = await buildWithCache(dir);

			expect(app).toContain('registerCacheDriver(postgresCacheDriver);');
			expect(app).not.toContain('@geekmidas/cache/redis');
		},
	);

	itWithDir(
		"registers the Redis drivers instead with --cache redis, as the compose stack's images are built",
		async ({ dir }) => {
			const app = await buildWithCache(dir, { cache: 'redis' });

			// Both schemes: the stack's own Redis, and a managed one over TLS.
			expect(app).toContain('registerCacheDriver(redisCacheDriver);');
			expect(app).toContain('registerCacheDriver(redissCacheDriver);');
			expect(app).not.toContain('postgresCacheDriver');
			expect(app).not.toContain('@geekmidas/cache/postgres');
		},
	);

	itWithDir(
		'should build endpoints, functions, and crons for multiple providers',
		async ({ dir }) => {
			// Create test files that will be discovered
			await createMockEndpointFile(
				dir,
				'src/endpoints/users.ts',
				'getUsersEndpoint',
				'/users',
				'GET',
			);
			await createMockEndpointFile(
				dir,
				'src/endpoints/posts.ts',
				'getPostsEndpoint',
				'/posts',
				'GET',
			);
			await createMockFunctionFile(
				dir,
				'src/functions/process.ts',
				'processDataFunction',
				60,
			);
			await createMockCronFile(
				dir,
				'src/crons/cleanup.ts',
				'cleanupCron',
				'rate(1 day)',
			);

			// Create a basic config file
			await createTestFile(
				dir,
				'gkm.config.ts',
				`
export default {
  stages: { local: 'development', deployed: ['production'] },
  constructs: './src/**/*.ts',
};
`,
			);

			// Create env and logger files
			await createTestFile(dir, 'config/env.ts', 'export default {}');
			await createTestFile(dir, 'config/logger.ts', 'export default {}');

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				await buildCommand({ provider: 'server' });

				// Check that output directories were created
				const serverDir = join(dir, '.gkm', 'server');

				// Check app.ts has the createApp function with new API
				const appContent = await readFile(join(serverDir, 'app.ts'), 'utf-8');
				expect(appContent).toContain('function createApp');
				expect(appContent).toContain('interface ServerApp');
				expect(appContent).toContain('async start(options');

				// Check endpoints.ts has the HonoEndpoint setup
				const endpointsContent = await readFile(
					join(serverDir, 'endpoints.ts'),
					'utf-8',
				);
				expect(endpointsContent).toContain('HonoEndpoint');

				// Verify server manifest was created at .gkm/manifest/server.ts
				// The application's declarations, with no route table beside them.
				// Its endpoints are on its surface, as on AWS, each served by the
				// one process.
				const { source, constructs } = await readManifest(
					join(dir, '.gkm', 'manifest', 'server.ts'),
				);
				expect(source).not.toContain('export const manifest');
				const [api] = ofKind(constructs, 'rest-api');
				expect(api.endpoints.length).toBeGreaterThan(0);
				expect(
					api.endpoints.every((e: any) => e.handler === '.gkm/server/app.ts'),
				).toBe(true);
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'should perform complete build with all construct types for AWS Lambda',
		async ({ dir }) => {
			// Create comprehensive test setup with all construct types
			await createMockEndpointFile(
				dir,
				'src/endpoints/users.ts',
				'getUsersEndpoint',
				'/users',
				'GET',
			);
			await createMockEndpointFile(
				dir,
				'src/endpoints/posts.ts',
				'getPostsEndpoint',
				'/posts',
				'POST',
			);
			await createMockFunctionFile(
				dir,
				'src/functions/processData.ts',
				'processDataFunction',
				300,
			);
			await createMockFunctionFile(
				dir,
				'src/functions/sendEmail.ts',
				'sendEmailFunction',
				30,
			);
			await createMockCronFile(
				dir,
				'src/crons/dailyCleanup.ts',
				'dailyCleanupCron',
				'rate(1 day)',
			);
			await createMockCronFile(
				dir,
				'src/crons/hourlyReport.ts',
				'hourlyReportCron',
				'cron(0 * * * ? *)',
			);

			// Create config
			await createTestFile(
				dir,
				'gkm.config.ts',
				`
export default {
  stages: { local: 'development', deployed: ['production'] },
  constructs: './src/**/*.ts',
};
`,
			);

			// Create env and logger files
			await createTestFile(dir, 'config/env.ts', 'export default {}');
			await createTestFile(dir, 'config/logger.ts', 'export default {}');

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				// Build for AWS Lambda
				await buildCommand({ provider: 'aws' });

				const awsLambdaDir = join(dir, '.gkm', 'aws');
				const awsApiGatewayV2Dir = join(dir, '.gkm', 'aws', 'routes');

				// Verify Lambda handlers were created
				expect(
					await readFile(
						join(awsLambdaDir, 'functions', 'processDataFunction.ts'),
						'utf-8',
					),
				).toContain('AWSLambdaFunction');
				expect(
					await readFile(
						join(awsLambdaDir, 'functions', 'sendEmailFunction.ts'),
						'utf-8',
					),
				).toContain('AWSLambdaFunction');

				// Verify Cron handlers were created
				expect(
					await readFile(
						join(awsLambdaDir, 'crons', 'dailyCleanupCron.ts'),
						'utf-8',
					),
				).toContain('AWSScheduledFunction');
				expect(
					await readFile(
						join(awsLambdaDir, 'crons', 'hourlyReportCron.ts'),
						'utf-8',
					),
				).toContain('AWSScheduledFunction');

				// Verify API Gateway handlers were created
				expect(
					await readFile(
						join(awsApiGatewayV2Dir, 'getUsersEndpoint.ts'),
						'utf-8',
					),
				).toContain('AmazonApiGatewayV2Endpoint');
				expect(
					await readFile(
						join(awsApiGatewayV2Dir, 'getPostsEndpoint.ts'),
						'utf-8',
					),
				).toContain('AmazonApiGatewayV2Endpoint');

				// Verify AWS manifest was created at .gkm/manifest/aws.ts
				// Every route, function and cron is in the declarations, folded
				// where it belongs — there is no route table beside them.
				const { source, constructs } = await readManifest(
					join(dir, '.gkm', 'manifest', 'aws.ts'),
				);
				expect(source).not.toContain('export const manifest');

				const [api] = ofKind(constructs, 'rest-api');
				expect(api.endpoints.map((e: any) => `${e.method} ${e.path}`)).toEqual(
					expect.arrayContaining(['GET /users', 'POST /posts']),
				);

				expect(constructs.processDataFunction).toMatchObject({
					kind: 'function',
					handler: '.gkm/aws/functions/processDataFunction.handler',
				});
				expect(constructs.sendEmailFunction?.kind).toBe('function');
				expect(constructs.dailyCleanupCron).toMatchObject({
					kind: 'cron',
					schedule: 'rate(1 day)',
				});
				expect(constructs.hourlyReportCron?.schedule).toBe('cron(0 * * * ? *)');
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir('should handle case with no constructs found', async ({ dir }) => {
		// Create a basic config file with no actual construct files
		await createTestFile(
			dir,
			'gkm.config.ts',
			`
export default {
  stages: { local: 'development', deployed: ['production'] },
  constructs: './src/**/*.ts',
};
`,
		);

		// Create env and logger files
		await createTestFile(dir, 'config/env.ts', 'export default {}');
		await createTestFile(dir, 'config/logger.ts', 'export default {}');

		const originalCwd = process.cwd();
		process.chdir(dir);

		const logSpy = vi.spyOn(console, 'log');

		try {
			await buildCommand({ provider: 'server' });

			expect(logSpy).toHaveBeenCalledWith('Found 0 endpoints');
			expect(logSpy).toHaveBeenCalledWith('Found 0 functions');
			expect(logSpy).toHaveBeenCalledWith('Found 0 crons');
			expect(logSpy).toHaveBeenCalledWith('Found 0 subscribers');
			expect(logSpy).toHaveBeenCalledWith('Found 0 queues');
			expect(logSpy).toHaveBeenCalledWith('Found 0 topics');
			expect(logSpy).toHaveBeenCalledWith(
				'No endpoints, functions, crons, subscribers, queues, or topics found to process',
			);
		} finally {
			process.chdir(originalCwd);
			logSpy.mockRestore();
		}
	});

	itWithDir(
		'should handle optional functions and crons config',
		async ({ dir }) => {
			// Create config with undefined functions and crons
			await createTestFile(
				dir,
				'gkm.config.ts',
				`
export default {
  stages: { local: 'development', deployed: ['production'] },
  constructs: './src/**/*.ts',
  functions: undefined,
  crons: undefined,
  envParser: './config/env',
  logger: './config/logger',
};
`,
			);

			await createMockEndpointFile(
				dir,
				'src/endpoints/test.ts',
				'testEndpoint',
				'/test',
				'GET',
			);

			// Create env and logger files
			await createTestFile(dir, 'config/env.ts', 'export default {}');
			await createTestFile(dir, 'config/logger.ts', 'export default {}');

			const originalCwd = process.cwd();
			process.chdir(dir);

			const logSpy = vi.spyOn(console, 'log');

			try {
				await buildCommand({ provider: 'server' });

				expect(logSpy).toHaveBeenCalledWith('Found 1 endpoints');
				expect(logSpy).toHaveBeenCalledWith('Found 0 functions');
				expect(logSpy).toHaveBeenCalledWith('Found 0 crons');

				// Should not log functions or crons loading messages
				expect(logSpy).not.toHaveBeenCalledWith(
					expect.stringContaining('Loading functions'),
				);
				expect(logSpy).not.toHaveBeenCalledWith(
					expect.stringContaining('Loading crons'),
				);
			} finally {
				process.chdir(originalCwd);
				logSpy.mockRestore();
			}
		},
	);

	itWithDir(
		'writes no environment import into a per-endpoint handler',
		async ({ dir }) => {
			// Create config with custom named exports
			await createTestFile(
				dir,
				'gkm.config.ts',
				`
export default {
  stages: { local: 'development', deployed: ['production'] },
  constructs: './src/**/*.ts',
  functions: undefined,
  crons: undefined,
  envParser: './config/env#customEnvParser',
  logger: './config/logger#customLogger',
};
`,
			);

			await createMockEndpointFile(
				dir,
				'src/endpoints/test.ts',
				'testEndpoint',
				'/test',
				'GET',
			);

			// Create env and logger files with named exports
			await createTestFile(
				dir,
				'config/env.ts',
				'export const customEnvParser = {}',
			);
			await createTestFile(
				dir,
				'config/logger.ts',
				'export const customLogger = {}',
			);

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				await buildCommand({ provider: 'aws' });

				// The handler imports its endpoint and nothing else. It used to be
				// handed a parser through an import the build composed as text,
				// which is the only reason a module path had to be named in
				// config at all — an endpoint built from its surface carries one.
				const handlerFile = join(dir, '.gkm/aws/routes/testEndpoint.ts');
				const handlerContent = await readFile(handlerFile, 'utf-8');
				expect(handlerContent).toContain('testEndpoint');
				expect(handlerContent).not.toContain('envParser');
				expect(handlerContent).not.toContain('customEnvParser');
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'generates an entry for a surface whose routes are declared',
		async ({ dir }) => {
			// An auth server's wildcard: there is nothing for a glob to find, and
			// that is not an empty app. The construct serves itself, so the entry
			// only has to start it — and a build that reported "nothing found" is
			// how the auth routes came to be served by nothing at all.
			await createTestFile(
				dir,
				'gkm.config.ts',
				`
export default {
  stages: { local: 'development', deployed: ['production'] },
  constructs: './src/**/*.ts',
  constructs: './constructs/**/*.ts',
  envParser: './config/env',
  logger: './config/logger',
};
`,
			);

			await createTestFile(
				dir,
				'constructs/auth.ts',
				`
export const auth = {
  id: 'Auth',
  declare: () => [
    {
      kind: 'rest-api',
      id: 'Auth',
      path: '.',
      provides: [],
      endpoints: [
        {
          id: 'AuthHandler',
          handler: 'Auth.handler',
          method: 'ANY',
          path: '/api/auth/*',
          dependencies: [],
        },
      ],
    },
  ],
  server: async () => ({ app: {} }),
};
`,
			);

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				await buildCommand({ provider: 'server' });

				const entry = await readFile(join(dir, '.gkm/server/app.ts'), 'utf-8');

				// It imports the construct discovery found, and starts it. It does
				// not restate the route — the declaration already carries it.
				expect(entry).toContain('import { auth as surface }');
				expect(entry).toContain('surface.server(');
				expect(entry).not.toContain('/api/auth/*');
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'builds for where the project deploys when no provider is given',
		async ({ dir }) => {
			await createTestFile(
				dir,
				'gkm.config.ts',
				`
export default {
  stages: { local: 'development', deployed: ['production'] },
  constructs: './src/**/*.ts',
  deploy: { default: 'dokploy' },
};
`,
			);

			await createMockEndpointFile(
				dir,
				'src/endpoints/test.ts',
				'testEndpoint',
				'/test',
				'GET',
			);

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				await buildCommand({});

				expect(existsSync(join(dir, '.gkm/server/app.ts'))).toBe(true);
				expect(existsSync(join(dir, '.gkm/aws'))).toBe(false);
				expect(existsSync(join(dir, '.gkm/manifest/server.ts'))).toBe(true);
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'writes one tree of handlers for aws, and no legacy provider directories',
		async ({ dir }) => {
			await createTestFile(
				dir,
				'gkm.config.ts',
				`
export default {
  stages: { local: 'development', deployed: ['production'] },
  constructs: './src/**/*.ts',
  deploy: { default: 'sst' },
};
`,
			);

			await createMockEndpointFile(
				dir,
				'src/endpoints/test.ts',
				'testEndpoint',
				'/test',
				'GET',
			);

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				await buildCommand({});

				expect(
					await readFile(join(dir, '.gkm/aws/routes/testEndpoint.ts'), 'utf-8'),
				).toContain('AmazonApiGatewayV2Endpoint');
				expect(await readdir(join(dir, '.gkm'))).toEqual(
					expect.not.arrayContaining([
						'aws-lambda',
						'aws-apigatewayv1',
						'aws-apigatewayv2',
					]),
				);

				const { constructs } = await readManifest(
					join(dir, '.gkm/manifest/aws.ts'),
				);
				const [api] = ofKind(constructs, 'rest-api');
				expect(api.endpoints[0].handler).toBe(
					'.gkm/aws/routes/testEndpoint.handler',
				);
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'leaves the manifest to the root, and hands back what it built with root paths',
		async ({ dir }) => {
			// An app's build writes its handlers; the manifest is the
			// application's, written once by the root from every app's output.
			const appRoot = join(dir, 'apps', 'api');
			await createMockEndpointFile(
				appRoot,
				'src/endpoints/test.ts',
				'testEndpoint',
				'/test',
				'GET',
			);

			const { built } = await buildApp({
				config: {
					stages: { local: 'development', deployed: ['production'] },
					constructs: './src/**/*.ts',
				},
				workspaceRoot: dir,
				appRoot,
				target: 'aws',
				enableOpenApi: false,
				cacheBackend: 'upstash',
				eventsBackend: 'sns',
				workspace: normalizeWorkspace(
					{ stages: { local: 'development', deployed: ['production'] } },
					dir,
				),
			});

			expect(existsSync(join(dir, '.gkm/manifest'))).toBe(false);
			expect(existsSync(join(appRoot, '.gkm/manifest'))).toBe(false);
			expect(built?.routes).toEqual([
				expect.objectContaining({
					handler: 'apps/api/.gkm/aws/routes/testEndpoint.handler',
				}),
			]);

			// The typed client is the application's too: at the root, where a
			// site's `@<name>/client/<surface>` alias points — not in the app.
			expect(existsSync(join(dir, '.gkm/client'))).toBe(true);
			expect(existsSync(join(appRoot, '.gkm/client'))).toBe(false);
		},
	);

	it('folds each app’s routes into its own surface, in one manifest', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'gkm-manifest-'));
		const surface = (id: string) => ({
			kind: 'rest-api',
			id,
			provides: [],
			endpoints: [],
		});
		const route = (app: string) => ({
			path: '/x',
			method: 'GET',
			handler: `apps/${app}/.gkm/aws/routes/x.handler`,
			authorizer: 'none',
		});

		try {
			await writeManifest({
				workspaceRoot: dir,
				target: 'aws',
				builds: ['api', 'admin'].map((app) => ({
					surface: app === 'api' ? 'Api' : 'Admin',
					routes: [route(app)],
					functions: [],
					crons: [],
					subscribers: [],
					queues: [],
					topics: [],
				})),
				constructs: { Api: surface('Api'), Admin: surface('Admin') } as never,
				backends: {},
			});

			const { constructs } = await readManifest(
				join(dir, '.gkm/manifest/aws.ts'),
			);
			expect(constructs.Api.endpoints[0].handler).toBe(
				'apps/api/.gkm/aws/routes/x.handler',
			);
			expect(constructs.Admin.endpoints[0].handler).toBe(
				'apps/admin/.gkm/aws/routes/x.handler',
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	itWithDir(
		'clears what an older build left, so only this build’s output is read',
		async ({ dir }) => {
			const appRoot = join(dir, 'apps', 'api');
			await createMockEndpointFile(
				appRoot,
				'src/endpoints/test.ts',
				'testEndpoint',
				'/test',
				'GET',
			);
			// The per-provider trees, an app-level manifest, and a handler for an
			// endpoint that no longer exists.
			for (const stale of [
				'.gkm/aws-lambda/routes/old.ts',
				'.gkm/aws-apigatewayv2/old.ts',
				'.gkm/manifest/aws.ts',
				'.gkm/aws/routes/deletedEndpoint.ts',
			]) {
				await createTestFile(appRoot, stale, 'export {};');
			}

			await buildApp({
				config: {
					stages: { local: 'development', deployed: ['production'] },
					constructs: './src/**/*.ts',
				},
				workspaceRoot: dir,
				appRoot,
				target: 'aws',
				enableOpenApi: false,
				cacheBackend: 'upstash',
				eventsBackend: 'sns',
				workspace: normalizeWorkspace(
					{ stages: { local: 'development', deployed: ['production'] } },
					dir,
				),
			});

			expect(await readdir(join(appRoot, '.gkm'))).toEqual(
				expect.not.arrayContaining([
					'aws-lambda',
					'aws-apigatewayv2',
					'manifest',
				]),
			);
			expect(await readdir(join(appRoot, '.gkm/aws/routes'))).toEqual([
				'testEndpoint.ts',
			]);
		},
	);

	// The two tests that stood here asserted the env parser's *module path* being
	// printed into the generated entry. That fallback is gone: every runnable
	// comes from a surface or a worker, and the entry imports that construct and
	// takes the parser off it. There is no path to print, and nothing left to
	// assert about printing one.
});
