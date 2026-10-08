import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { itWithDir } from '@geekmidas/testkit/os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createMockBuildContext,
	createMockEndpointFile,
	createTestEndpoint,
} from '../../__tests__/test-helpers';
import { EndpointGenerator } from '../EndpointGenerator';

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
			target: 'server',
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
				target: 'server',
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
				target: 'aws',
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
				target: 'aws',
			});

			expect(routes).toHaveLength(1);

			const handlerPath = join(outputDir, 'routes', 'testEndpoint.ts');
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

	itWithDir('builds for aws when no target is given', async ({ dir }) => {
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

		// One Lambda per endpoint, behind an HTTP API
		const handlerPath = join(outputDir, 'routes', 'testEndpoint.ts');
		const handlerContent = await readFile(handlerPath, 'utf-8');
		expect(handlerContent).toContain('AmazonApiGatewayV2Endpoint');
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
				target: 'aws',
			});

			const handlerPath = join(outputDir, 'routes', 'deepEndpoint.ts');
			const handlerContent = await readFile(handlerPath, 'utf-8');

			// Check that relative imports are correct
			expect(handlerContent).toContain(
				"from '../../src/api/endpoints/deepEndpoint.js'",
			);

			// And that it is the only relative import. The handler used to carry a
			// second one the build composed for the environment parser, which is
			// why a module path had to be named in config; an endpoint built from
			// its surface already carries the parser.
			const relative = handlerContent.match(/from '\.[^']*'/g) ?? [];
			expect(relative).toEqual([
				"from '../../src/api/endpoints/deepEndpoint.js'",
			]);
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
			target: 'server',
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
				},
			};

			await generator.build(productionContext, constructs, outputDir, {
				target: 'server',
			});

			const appPath = join(outputDir, 'app.ts');
			const appContent = await readFile(appPath, 'utf-8');

			expect(appContent).toContain('Generated production server application');
			expect(appContent).toContain("honoApp.get('/health'");
			expect(appContent).toContain("honoApp.get('/ready'");
			expect(appContent).toContain('Graceful shutdown initiated');
			// Stops taking requests, then closes what constructs opened (the
			// database pools) before exiting.
			expect(appContent).toContain(
				"import { runShutdownHooks } from '@geekmidas/constructs'",
			);
			expect(appContent).toContain(
				'server = await options.serve(honoApp, port)',
			);
			expect(appContent).toContain('close.call(server, () => resolve())');
			expect(appContent).toContain('await runShutdownHooks(');

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
		'should start telemetry in the production entry before importing the app',
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

			await generator.build(
				{
					...context,
					production: {
						enabled: true,
						healthCheck: '/health',
						gracefulShutdown: true,
						openapi: false,
						subscribers: 'exclude' as const,
					},
					telemetry: {
						serviceName: 'Api',
						serviceNamespace: 'shop',
						ignorePaths: [],
						attributes: {},
						routes: [],
					},
				},
				constructs,
				outputDir,
				{ target: 'server' },
			);

			const server = await readFile(join(outputDir, 'server.ts'), 'utf-8');
			// The app is imported only once telemetry has started, so the
			// libraries it loads are the instrumented ones.
			expect(server).toContain(
				"const { startTelemetry } = await import('./telemetry.js');",
			);
			expect(server).not.toContain("import { createApp } from './app.js'");
			expect(server.indexOf('await startTelemetry(')).toBeLessThan(
				server.indexOf("await import('./app.js')"),
			);
			// Its request-span middleware goes on ahead of every route, and the
			// health checks open no span.
			expect(server).toContain(
				'const requestSpans = await startTelemetry({\n  ignorePaths: ["/health","/ready"],',
			);
			expect(server).toContain("if (requestSpans) app.use('*', requestSpans);");
			expect(server.indexOf("app.use('*', requestSpans)")).toBeLessThan(
				server.indexOf('await createApp(app)'),
			);

			const telemetry = await readFile(
				join(outputDir, 'telemetry.ts'),
				'utf-8',
			);
			expect(telemetry).toContain(
				'if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return undefined;',
			);
			expect(telemetry).toContain(
				"await import('@geekmidas/telescope/instrumentation')",
			);
			expect(telemetry).toContain('serviceName: "Api",');
			expect(telemetry).toContain('serviceNamespace: "shop",');
			expect(telemetry).toContain('deploymentEnvironment: process.env.STAGE,');
			expect(telemetry).toContain('handleSignals: false,');
			expect(telemetry).toContain('instrumentPino: false,');
			expect(telemetry).toContain('incomingHttpSpans: false,');
			expect(telemetry).toContain('class TelemetryUnavailable extends Error');
		},
	);

	itWithDir(
		'gives a server with no Telemetry edge the stub, which loads nothing',
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

			await generator.build(
				{
					...context,
					production: {
						enabled: true,
						healthCheck: '/health',
						gracefulShutdown: true,
						openapi: false,
						subscribers: 'exclude' as const,
					},
				},
				constructs,
				outputDir,
				{ target: 'server' },
			);

			const telemetry = await readFile(
				join(outputDir, 'telemetry.ts'),
				'utf-8',
			);
			expect(telemetry).not.toContain("@geekmidas/telescope/instrumentation')");
			expect(telemetry).not.toMatch(/import\(['"]@/);
			// Nothing to say: telemetry is not something this process was given.
			expect(telemetry).not.toContain('TelemetryUnavailable');
			expect(telemetry).toContain('return undefined;');
		},
	);

	itWithDir(
		'names a production server to Postgres after its surface',
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

			await generator.build(
				{
					...context,
					...createMockBuildContext(),
					production: {
						enabled: true,
						healthCheck: '/health',
						gracefulShutdown: true,
						openapi: false,
						subscribers: 'exclude' as const,
					},
				},
				constructs,
				outputDir,
				{ target: 'server' },
			);

			const appContent = await readFile(join(outputDir, 'app.ts'), 'utf-8');
			// A fallback: an operator's GKM_APP_NAME still wins.
			expect(appContent).toContain('process.env.GKM_APP_NAME ??= "Api";');
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
				},
			};

			await generator.build(productionContext, constructs, outputDir, {
				target: 'server',
			});

			const appPath = join(outputDir, 'app.ts');
			const appContent = await readFile(appPath, 'utf-8');

			expect(appContent).toContain('import { setupSubscribers }');
			// Subscribers get the app, to mount their push routes on, and are
			// subscribed only once the server is listening.
			expect(appContent).toContain(
				'await setupSubscribers(honoApp, envParser, logger)',
			);
			expect(appContent).toContain('await subscribeForPush(port);');
			expect(appContent).toContain(
				'setupEndpoints(honoApp, envParser, logger, true)',
			);
		},
	);

	itWithDir('should log handler generation for each route', async ({ dir }) => {
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
			target: 'aws',
		});

		expect(logSpy).toHaveBeenCalledWith('Generated handler for GET /test');
		logSpy.mockRestore();
	});

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
				target: 'aws',
			});

			expect(logSpy).toHaveBeenCalledWith(
				'Generated handler for POST /api/users',
			);
			logSpy.mockRestore();
		},
	);
});
