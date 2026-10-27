import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HttpMethod } from '@geekmidas/constructs';
import { type Endpoint, e } from '@geekmidas/constructs/endpoints';
import { heartbeat } from '@geekmidas/constructs/monitors';
import { itWithDir } from '@geekmidas/testkit/os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createMockBuildContext,
	createMockEndpointFile,
	createTestEndpoint,
} from '../../__tests__/test-helpers';
import { EndpointGenerator } from '../EndpointGenerator';
import type { GeneratedConstruct } from '../Generator';

describe('EndpointGenerator', () => {
	let _tempDir: string;
	let _outputDir: string;
	let generator: EndpointGenerator;
	let context: ReturnType<typeof createMockBuildContext>;

	beforeEach(async () => {
		generator = new EndpointGenerator();
		context = createMockBuildContext();
	});

	afterEach(async () => {});

	it('should identify valid endpoints', () => {
		const testEndpoint = createTestEndpoint('/test', 'GET');
		expect(generator.isConstruct(testEndpoint)).toBe(true);
	});

	it('should reject invalid constructs', () => {
		expect(generator.isConstruct({})).toBe(false);
		expect(generator.isConstruct('string')).toBe(false);
		expect(generator.isConstruct(null)).toBe(false);
	});

	const createTestEndpointConstruct = (
		key: string,
		path: string,
		method: HttpMethod,
		dir: string,
	): GeneratedConstruct<Endpoint<any, any, any, any, any, any>> => ({
		key,
		name: key.toLowerCase(),
		construct: createTestEndpoint(path, method),
		path: {
			absolute: join(dir, `${key}.ts`),
			relative: `./${key}.ts`,
		},
	});

	describe('monitoring', () => {
		const MONITOR = {
			type: 'heartbeat',
			provider: 'betterStack',
			env: 'MONITORING_URL',
		};
		let dir: string;

		beforeEach(async () => {
			dir = await mkdtemp(join(tmpdir(), 'endpoint-monitoring-'));
			await mkdir(join(dir, 'output'), { recursive: true });
		});

		afterEach(async () => {
			await rm(dir, { recursive: true, force: true });
		});

		const monitoredAt = (key: string, path: string) => {
			const construct = createTestEndpointConstruct(key, path, 'GET', dir);
			construct.construct = e
				.monitor(heartbeat.betterStack('MONITORING_URL'))
				.get(path)
				.handle(async () => ({}));
			return construct;
		};

		it.each([
			'aws-lambda',
			'aws-apigatewayv2',
		] as const)('records each route’s monitors (%s)', async (provider) => {
			const routes = await generator.build(
				context,
				[
					monitoredAt('monitored', '/monitored'),
					createTestEndpointConstruct('plain', '/plain', 'GET', dir),
				],
				join(dir, 'output'),
				{ provider },
			);

			expect(routes.find((r) => r.path === '/monitored')?.monitoring).toEqual([
				MONITOR,
			]);
			expect(
				routes.find((r) => r.path === '/plain')?.monitoring,
			).toBeUndefined();
		});

		it('records the distinct monitors across endpoints on the server route', async () => {
			const routes = await generator.build(
				context,
				[
					monitoredAt('first', '/first'),
					monitoredAt('second', '/second'),
					createTestEndpointConstruct('plain', '/plain', 'GET', dir),
				],
				join(dir, 'output'),
				{ provider: 'server' },
			);

			expect(routes).toHaveLength(1);
			expect(routes[0].monitoring).toEqual([MONITOR]);
		});

		it('records no monitoring on a server whose endpoints have none', async () => {
			const routes = await generator.build(
				context,
				[createTestEndpointConstruct('plain', '/plain', 'GET', dir)],
				join(dir, 'output'),
				{ provider: 'server' },
			);

			expect(routes[0].monitoring).toBeUndefined();
		});
	});

	itWithDir('should generate a single server app file', async ({ dir }) => {
		const outputDir = join(dir, 'output');
		const routesDir = join(dir, 'routes');
		await mkdir(outputDir, { recursive: true });

		await Promise.all([
			createMockEndpointFile(
				routesDir,
				'testEndpoint.ts',
				'testEndpoint',
				'/test',
				'GET',
			),
			createMockEndpointFile(
				routesDir,
				'anotherEndpoint.ts',
				'anotherEndpoint',
				'/another',
				'POST',
			),
		]);

		const constructs = await generator.load('**/routes/*.ts', dir);

		const routes = await generator.build(context, constructs, outputDir, {
			provider: 'server',
			enableOpenApi: true,
		});

		expect(routes).toHaveLength(1);
		expect(routes[0]).toMatchObject({
			path: '*',
			method: 'ALL',
			handler: expect.stringContaining('app.ts'),
		});

		// Check that the app.ts file was created
		const appPath = join(outputDir, 'app.ts');
		const appContent = await readFile(appPath, 'utf-8');

		expect(appContent).toContain('import { setupEndpoints }');
		expect(appContent).toContain('import { setupSubscribers }');
		expect(appContent).toContain('function createApp');
		expect(appContent).toContain('app?: HonoType');
		expect(appContent).toContain('enableOpenApi: boolean = true');
		expect(appContent).toContain('interface ServerApp');
		expect(appContent).toContain('async start(options');
		expect(appContent).toContain('serve: (app: HonoType, port: number)');

		// Check that the endpoints.ts file was created with endpoint logic
		const endpointsPath = join(outputDir, 'endpoints.ts');
		const endpointsContent = await readFile(endpointsPath, 'utf-8');

		expect(endpointsContent).toContain('import { HonoEndpoint }');
		expect(endpointsContent).toContain('import { testEndpoint }');
		expect(endpointsContent).toContain('import { anotherEndpoint }');
		// Function signature always defaults to true
		expect(endpointsContent).toContain('enableOpenApi: boolean = true');
		// OpenAPI options are configured based on the parameter
		expect(endpointsContent).toContain("docsPath: '/__docs'");
	});

	itWithDir(
		'should generate server app without OpenAPI when disabled',
		async ({ dir }) => {
			const outputDir = join(dir, 'output');
			const routesDir = join(dir, 'routes');
			await mkdir(outputDir, { recursive: true });

			await createMockEndpointFile(
				routesDir,
				'testEndpoint.ts',
				'testEndpoint',
				'/test',
				'GET',
			);

			const constructs = await generator.load('**/routes/*.ts', dir);

			await generator.build(context, constructs, outputDir, {
				provider: 'server',
				enableOpenApi: false,
			});

			const appPath = join(outputDir, 'app.ts');
			const appContent = await readFile(appPath, 'utf-8');

			expect(appContent).toContain('function createApp');

			// Check that the endpoints.ts file defaults to true (but can be overridden)
			const endpointsPath = join(outputDir, 'endpoints.ts');
			const endpointsContent = await readFile(endpointsPath, 'utf-8');

			// The function signature always defaults to true
			expect(endpointsContent).toContain('enableOpenApi: boolean = true');
			// But the OpenAPI options are configured dynamically based on the parameter
			expect(endpointsContent).toContain('docsPath: false');
		},
	);

	itWithDir(
		'should generate individual handlers in routes subdirectory',
		async ({ dir }) => {
			const outputDir = join(dir, 'output');
			const routesDir = join(dir, 'routes');
			await mkdir(outputDir, { recursive: true });

			await Promise.all([
				createMockEndpointFile(
					routesDir,
					'testEndpoint.ts',
					'testEndpoint',
					'/test',
					'GET',
				),
				createMockEndpointFile(
					routesDir,
					'anotherEndpoint.ts',
					'anotherEndpoint',
					'/another',
					'POST',
				),
			]);

			const constructs = await generator.load('**/routes/*.ts', dir);

			const routes = await generator.build(context, constructs, outputDir, {
				provider: 'aws-lambda',
			});

			expect(routes).toHaveLength(2);

			// Find routes by their path since order may vary
			const testRoute = routes.find((r) => r.path === '/test');
			const anotherRoute = routes.find((r) => r.path === '/another');

			expect(testRoute).toMatchObject({
				path: '/test',
				method: 'GET',
				handler: expect.stringContaining('routes/testEndpoint.handler'),
			});
			expect(anotherRoute).toMatchObject({
				path: '/another',
				method: 'POST',
				handler: expect.stringContaining('routes/anotherEndpoint.handler'),
			});

			// Check that handler files were created
			const testHandlerPath = join(outputDir, 'routes', 'testEndpoint.ts');
			const testHandlerContent = await readFile(testHandlerPath, 'utf-8');
			expect(testHandlerContent).toContain('AmazonApiGatewayV2Endpoint');
			expect(testHandlerContent).toContain('import { testEndpoint }');

			const anotherHandlerPath = join(
				outputDir,
				'routes',
				'anotherEndpoint.ts',
			);
			const anotherHandlerContent = await readFile(anotherHandlerPath, 'utf-8');
			expect(anotherHandlerContent).toContain('AmazonApiGatewayV2Endpoint');
			expect(anotherHandlerContent).toContain('import { anotherEndpoint }');
		},
	);

	itWithDir(
		'should generate individual handlers with v1 adapter',
		async ({ dir }) => {
			const outputDir = join(dir, 'output');
			const routesDir = join(dir, 'routes');
			await mkdir(outputDir, { recursive: true });

			await createMockEndpointFile(
				routesDir,
				'testEndpoint.ts',
				'testEndpoint',
				'/test',
				'GET',
			);

			const constructs = await generator.load('**/routes/*.ts', dir);

			const routes = await generator.build(context, constructs, outputDir, {
				provider: 'aws-apigatewayv1',
			});

			expect(routes).toHaveLength(1);

			const handlerPath = join(outputDir, 'testEndpoint.ts');
			const handlerContent = await readFile(handlerPath, 'utf-8');
			expect(handlerContent).toContain('AmazonApiGatewayV1Endpoint');
			expect(handlerContent).toContain('import { testEndpoint }');
		},
	);

	itWithDir(
		'should generate individual handlers with v2 adapter',
		async ({ dir }) => {
			const outputDir = join(dir, 'output');
			const routesDir = join(dir, 'routes');
			await mkdir(outputDir, { recursive: true });

			await createMockEndpointFile(
				routesDir,
				'testEndpoint.ts',
				'testEndpoint',
				'/test',
				'GET',
			);

			const constructs = await generator.load('**/routes/*.ts', dir);

			const routes = await generator.build(context, constructs, outputDir, {
				provider: 'aws-apigatewayv2',
			});

			expect(routes).toHaveLength(1);

			const handlerPath = join(outputDir, 'testEndpoint.ts');
			const handlerContent = await readFile(handlerPath, 'utf-8');
			expect(handlerContent).toContain('AmazonApiGatewayV2Endpoint');
			expect(handlerContent).toContain('import { testEndpoint }');
		},
	);

	itWithDir(
		'should return empty array for empty constructs',
		async ({ dir }) => {
			const outputDir = join(dir, 'output');
			const routes = await generator.build(context, [], outputDir);
			expect(routes).toEqual([]);
		},
	);

	itWithDir(
		'should use default provider when none specified',
		async ({ dir }) => {
			const outputDir = join(dir, 'output');
			const routesDir = join(dir, 'routes');
			await mkdir(outputDir, { recursive: true });

			await createMockEndpointFile(
				routesDir,
				'testEndpoint.ts',
				'testEndpoint',
				'/test',
				'GET',
			);

			const constructs = await generator.load('**/routes/*.ts', dir);

			const routes = await generator.build(context, constructs, outputDir);

			expect(routes).toHaveLength(1);

			// Should use default aws-apigatewayv2
			const handlerPath = join(outputDir, 'testEndpoint.ts');
			const handlerContent = await readFile(handlerPath, 'utf-8');
			expect(handlerContent).toContain('AmazonApiGatewayV2Endpoint');
		},
	);

	itWithDir('should throw error for unsupported provider', async ({ dir }) => {
		const outputDir = join(dir, 'output');
		const constructs = [
			createTestEndpointConstruct('testEndpoint', '/test', 'GET', dir),
		];

		await expect(
			generator.build(context, constructs, outputDir, {
				provider: 'unsupported' as any,
			}),
		).rejects.toThrow('Unsupported provider: unsupported');
	});

	itWithDir(
		'should generate correct import paths for nested files',
		async ({ dir }) => {
			const outputDir = join(dir, 'output');
			const nestedDir = join(dir, 'src', 'api', 'endpoints');
			await mkdir(outputDir, { recursive: true });

			await createMockEndpointFile(
				nestedDir,
				'deepEndpoint.ts',
				'deepEndpoint',
				'/deep',
				'GET',
			);

			const constructs = await generator.load('**/src/api/endpoints/*.ts', dir);

			await generator.build(context, constructs, outputDir, {
				provider: 'aws-apigatewayv2',
			});

			const handlerPath = join(outputDir, 'deepEndpoint.ts');
			const handlerContent = await readFile(handlerPath, 'utf-8');

			// Check that relative imports are correct
			expect(handlerContent).toContain(
				"from '../src/api/endpoints/deepEndpoint.js'",
			);
			expect(handlerContent).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/.*\/env['"]/);
		},
	);

	itWithDir('should log generation progress', async ({ dir }) => {
		const logSpy = vi.spyOn(console, 'log');
		const outputDir = join(dir, 'output');
		const routesDir = join(dir, 'routes');
		await mkdir(outputDir, { recursive: true });

		await Promise.all([
			createMockEndpointFile(
				routesDir,
				'endpoint1.ts',
				'endpoint1',
				'/test1',
				'GET',
			),
			createMockEndpointFile(
				routesDir,
				'endpoint2.ts',
				'endpoint2',
				'/test2',
				'POST',
			),
		]);

		const constructs = await generator.load('**/routes/*.ts', dir);

		await generator.build(context, constructs, outputDir, {
			provider: 'server',
		});

		expect(logSpy).toHaveBeenCalledWith('Generated server with 2 endpoints');

		logSpy.mockRestore();
	});

	itWithDir(
		'should generate production app file when production mode is enabled',
		async ({ dir }) => {
			const outputDir = join(dir, 'output');
			const routesDir = join(dir, 'routes');
			await mkdir(outputDir, { recursive: true });

			await createMockEndpointFile(
				routesDir,
				'testEndpoint.ts',
				'testEndpoint',
				'/test',
				'GET',
			);

			const constructs = await generator.load('**/routes/*.ts', dir);

			const productionContext = {
				...context,
				production: {
					enabled: true,
					healthCheck: '/health',
					gracefulShutdown: true,
					openapi: false,
					subscribers: 'exclude' as const,
					optimizedHandlers: false,
				},
			};

			await generator.build(productionContext, constructs, outputDir, {
				provider: 'server',
			});

			const appPath = join(outputDir, 'app.ts');
			const appContent = await readFile(appPath, 'utf-8');

			expect(appContent).toContain('Generated production server application');
			expect(appContent).toContain("honoApp.get('/health'");
			expect(appContent).toContain("honoApp.get('/ready'");
			expect(appContent).toContain('Graceful shutdown initiated');

			// Check server.ts entry point was generated
			const serverPath = join(outputDir, 'server.ts');
			const serverContent = await readFile(serverPath, 'utf-8');
			expect(serverContent).toContain('Production server entry point');
			expect(serverContent).toContain(
				"import { serve } from '@hono/node-server'",
			);
		},
	);

	itWithDir(
		'should generate production app with subscribers when include option is set',
		async ({ dir }) => {
			const outputDir = join(dir, 'output');
			const routesDir = join(dir, 'routes');
			await mkdir(outputDir, { recursive: true });

			await createMockEndpointFile(
				routesDir,
				'testEndpoint.ts',
				'testEndpoint',
				'/test',
				'GET',
			);

			const constructs = await generator.load('**/routes/*.ts', dir);

			const productionContext = {
				...context,
				production: {
					enabled: true,
					healthCheck: '/health',
					gracefulShutdown: false,
					openapi: true,
					subscribers: 'include' as const,
					optimizedHandlers: false,
				},
			};

			await generator.build(productionContext, constructs, outputDir, {
				provider: 'server',
			});

			const appPath = join(outputDir, 'app.ts');
			const appContent = await readFile(appPath, 'utf-8');

			expect(appContent).toContain('import { setupSubscribers }');
			expect(appContent).toContain('Start subscribers in background');
			expect(appContent).toContain(
				'setupEndpoints(honoApp, envParser, logger, true)',
			);
		},
	);

	itWithDir(
		'should log aws-lambda handler generation for each route',
		async ({ dir }) => {
			const logSpy = vi.spyOn(console, 'log');
			const outputDir = join(dir, 'output');
			const routesDir = join(dir, 'routes');
			await mkdir(outputDir, { recursive: true });

			await createMockEndpointFile(
				routesDir,
				'testEndpoint.ts',
				'testEndpoint',
				'/test',
				'GET',
			);

			const constructs = await generator.load('**/routes/*.ts', dir);

			await generator.build(context, constructs, outputDir, {
				provider: 'aws-lambda',
			});

			expect(logSpy).toHaveBeenCalledWith('Generated handler for GET /test');
			logSpy.mockRestore();
		},
	);

	itWithDir(
		'should log apigatewayv2 handler generation for each route',
		async ({ dir }) => {
			const logSpy = vi.spyOn(console, 'log');
			const outputDir = join(dir, 'output');
			const routesDir = join(dir, 'routes');
			await mkdir(outputDir, { recursive: true });

			await createMockEndpointFile(
				routesDir,
				'testEndpoint.ts',
				'testEndpoint',
				'/api/users',
				'POST',
			);

			const constructs = await generator.load('**/routes/*.ts', dir);

			await generator.build(context, constructs, outputDir, {
				provider: 'aws-apigatewayv2',
			});

			expect(logSpy).toHaveBeenCalledWith(
				'Generated handler for POST /api/users',
			);
			logSpy.mockRestore();
		},
	);
});
