import { describe, expect, it } from 'vitest';
import type { EndpointAnalysis, EndpointFeatures } from '../endpoint-analyzer';
import {
	generateEndpointFilesByTier,
	generateEndpointFilesNested,
	generateMinimalHandler,
	generateOptimizedEndpointsFile,
	generateOptimizedImports,
	generateOptimizedSetupFunction,
	generateStandardHandler,
	generateValidatorFactories,
} from '../handler-templates';

// Helper to create endpoint features
function createFeatures(
	overrides: Partial<EndpointFeatures> = {},
): EndpointFeatures {
	return {
		hasAuth: false,
		hasServices: false,
		hasDatabase: false,
		hasBodyValidation: false,
		hasQueryValidation: false,
		hasParamValidation: false,
		hasAudits: false,
		hasEvents: false,
		hasRateLimit: false,
		hasRls: false,
		hasOutputValidation: false,
		...overrides,
	};
}

// Helper to create analysis
function createAnalysis(
	overrides: Partial<EndpointAnalysis> = {},
): EndpointAnalysis {
	return {
		route: '/test',
		method: 'GET',
		exportName: 'testEndpoint',
		tier: 'minimal',
		serviceNames: [],
		features: createFeatures(),
		...overrides,
	};
}

describe('handler-templates', () => {
	describe('generateOptimizedImports', () => {
		it('should always include base imports', () => {
			const result = generateOptimizedImports([]);

			expect(result).toContain('import type { EnvironmentParser }');
			expect(result).toContain('import type { Logger }');
			expect(result).toContain('import type { Hono }');
			expect(result).toContain('import { Endpoint }');
		});

		it('should include validator import when body validation needed', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasBodyValidation: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain('import { validator }');
		});

		it('should include validator import when query validation needed', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasQueryValidation: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain('import { validator }');
		});

		it('should include validator import when param validation needed', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasParamValidation: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain('import { validator }');
		});

		it('should include ResponseBuilder for standard tier', () => {
			const analyses = [
				createAnalysis({
					tier: 'standard',
					features: createFeatures({ hasAuth: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain('import { ResponseBuilder }');
		});

		it('should include ResponseBuilder for full tier', () => {
			const analyses = [
				createAnalysis({
					tier: 'full',
					features: createFeatures({ hasAudits: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain('import { ResponseBuilder }');
		});

		it('should include ServiceDiscovery when services are used', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasServices: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain('import { ServiceDiscovery }');
		});

		it('should include ServiceDiscovery when database is used', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasDatabase: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain('import { ServiceDiscovery }');
		});

		it('should include events import when events are used', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasEvents: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain('import { publishConstructEvents }');
		});

		it('should include audit imports when audits are used', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasAudits: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain('createAuditContext');
			expect(result).toContain('withAuditableEndpointTransaction');
		});

		it('should include createError when rate limiting is used', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasRateLimit: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain('import { createError }');
		});

		it('should include RLS imports when RLS is used', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasRls: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain('withRlsContext');
			expect(result).toContain('extractRlsContext');
		});

		it('should not include optional imports when not needed', () => {
			const analyses = [createAnalysis()];

			const result = generateOptimizedImports(analyses);
			expect(result).not.toContain('import { validator }');
			expect(result).not.toContain('ServiceDiscovery');
			expect(result).not.toContain('publishConstructEvents');
			expect(result).not.toContain('createAuditContext');
			expect(result).not.toContain('createError');
			expect(result).not.toContain('withRlsContext');
		});
	});

	describe('generateValidatorFactories', () => {
		it('should return empty string when no validation needed', () => {
			const result = generateValidatorFactories([createAnalysis()]);
			expect(result).toBe('');
		});

		it('should generate body validator when body validation needed', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasBodyValidation: true }),
				}),
			];

			const result = generateValidatorFactories(analyses);
			expect(result).toContain('validateBody');
			expect(result).toContain("validator('json'");
			expect(result).toContain('endpoint.input?.body');
		});

		it('should generate query validator when query validation needed', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasQueryValidation: true }),
				}),
			];

			const result = generateValidatorFactories(analyses);
			expect(result).toContain('validateQuery');
			expect(result).toContain("validator('query'");
			expect(result).toContain('endpoint.input?.query');
		});

		it('should generate params validator when param validation needed', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasParamValidation: true }),
				}),
			];

			const result = generateValidatorFactories(analyses);
			expect(result).toContain('validateParams');
			expect(result).toContain("validator('param'");
			expect(result).toContain('endpoint.input?.params');
		});

		it('should generate all validators when all validation types needed', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({
						hasBodyValidation: true,
						hasQueryValidation: true,
						hasParamValidation: true,
					}),
				}),
			];

			const result = generateValidatorFactories(analyses);
			expect(result).toContain('validateBody');
			expect(result).toContain('validateQuery');
			expect(result).toContain('validateParams');
		});

		it('should handle multiple endpoints with different validation', () => {
			const analyses = [
				createAnalysis({
					exportName: 'endpoint1',
					features: createFeatures({ hasBodyValidation: true }),
				}),
				createAnalysis({
					exportName: 'endpoint2',
					features: createFeatures({ hasQueryValidation: true }),
				}),
			];

			const result = generateValidatorFactories(analyses);
			expect(result).toContain('validateBody');
			expect(result).toContain('validateQuery');
			expect(result).not.toContain('validateParams');
		});
	});

	describe('generateMinimalHandler', () => {
		it('should generate inline handler for truly minimal endpoints', () => {
			const analysis = createAnalysis({
				route: '/health',
				method: 'GET',
				exportName: 'healthEndpoint',
				tier: 'minimal',
			});

			const result = generateMinimalHandler(analysis);

			expect(result).toContain("app.get('/health'");
			expect(result).toContain('healthEndpoint.handler');
			expect(result).toContain('Minimal handler: /health (GET)');
			expect(result).toContain('c.json(result');
		});

		it('should generate handler with body validation', () => {
			const analysis = createAnalysis({
				route: '/users',
				method: 'POST',
				exportName: 'createUserEndpoint',
				tier: 'minimal',
				features: createFeatures({ hasBodyValidation: true }),
			});

			const result = generateMinimalHandler(analysis);

			expect(result).toContain("app.post('/users'");
			expect(result).toContain('Minimal handler with validation');
			expect(result).toContain("(c.req.valid as any)('json')");
		});

		it('should generate handler with query validation', () => {
			const analysis = createAnalysis({
				route: '/search',
				method: 'GET',
				exportName: 'searchEndpoint',
				tier: 'minimal',
				features: createFeatures({ hasQueryValidation: true }),
			});

			const result = generateMinimalHandler(analysis);

			expect(result).toContain("(c.req.valid as any)('query')");
		});

		it('should generate handler with param validation', () => {
			const analysis = createAnalysis({
				route: '/users/:id',
				method: 'GET',
				exportName: 'getUserEndpoint',
				tier: 'minimal',
				features: createFeatures({ hasParamValidation: true }),
			});

			const result = generateMinimalHandler(analysis);

			expect(result).toContain("(c.req.valid as any)('param')");
		});

		it('should generate handler with output validation', () => {
			const analysis = createAnalysis({
				route: '/data',
				method: 'GET',
				exportName: 'dataEndpoint',
				tier: 'minimal',
				features: createFeatures({ hasOutputValidation: true }),
			});

			const result = generateMinimalHandler(analysis);

			expect(result).toContain('parseOutput(result)');
		});

		it('should generate handler with all validation types', () => {
			const analysis = createAnalysis({
				route: '/items/:id',
				method: 'PUT',
				exportName: 'updateItemEndpoint',
				tier: 'minimal',
				features: createFeatures({
					hasBodyValidation: true,
					hasQueryValidation: true,
					hasParamValidation: true,
					hasOutputValidation: true,
				}),
			});

			const result = generateMinimalHandler(analysis);

			expect(result).toContain("(c.req.valid as any)('json')");
			expect(result).toContain("(c.req.valid as any)('query')");
			expect(result).toContain("(c.req.valid as any)('param')");
			expect(result).toContain('parseOutput(result)');
		});
	});

	describe('generateStandardHandler', () => {
		it('should generate handler with services', () => {
			const analysis = createAnalysis({
				route: '/api/data',
				method: 'GET',
				exportName: 'dataEndpoint',
				tier: 'standard',
				features: createFeatures({ hasServices: true }),
			});

			const result = generateStandardHandler(analysis);

			expect(result).toContain('Standard handler: /api/data (GET)');
			expect(result).toContain('serviceDiscovery.register');
			expect(result).toContain('ResponseBuilder');
		});

		it('should generate handler with database', () => {
			const analysis = createAnalysis({
				route: '/api/users',
				method: 'GET',
				exportName: 'usersEndpoint',
				tier: 'standard',
				features: createFeatures({ hasDatabase: true }),
			});

			const result = generateStandardHandler(analysis);

			expect(result).toContain('databaseService');
			expect(result).toContain('serviceDiscovery.register');
		});

		it('should generate handler with authentication', () => {
			const analysis = createAnalysis({
				route: '/api/profile',
				method: 'GET',
				exportName: 'profileEndpoint',
				tier: 'standard',
				features: createFeatures({ hasAuth: true }),
			});

			const result = generateStandardHandler(analysis);

			expect(result).toContain('// Authentication');
			expect(result).toContain('getSession');
			expect(result).toContain('authorize');
			expect(result).toContain('Unauthorized');
		});

		it('should generate handler with events', () => {
			const analysis = createAnalysis({
				route: '/api/orders',
				method: 'POST',
				exportName: 'createOrderEndpoint',
				tier: 'standard',
				features: createFeatures({ hasEvents: true }),
			});

			const result = generateStandardHandler(analysis);

			expect(result).toContain('publishConstructEvents');
			expect(result).toContain('isSuccessStatus');
		});

		it('should generate handler without services when not needed', () => {
			const analysis = createAnalysis({
				route: '/api/simple',
				method: 'GET',
				exportName: 'simpleEndpoint',
				tier: 'standard',
				features: createFeatures({ hasAuth: true }),
			});

			const result = generateStandardHandler(analysis);

			expect(result).toContain('const services = {};');
			expect(result).toContain('const db = undefined;');
		});

		it('should generate handler with body validation', () => {
			const analysis = createAnalysis({
				route: '/api/items',
				method: 'POST',
				exportName: 'createItemEndpoint',
				tier: 'standard',
				features: createFeatures({
					hasServices: true,
					hasBodyValidation: true,
				}),
			});

			const result = generateStandardHandler(analysis);

			expect(result).toContain("(c.req.valid as any)('json')");
		});

		it('should generate handler with all features', () => {
			const analysis = createAnalysis({
				route: '/api/complex/:id',
				method: 'PUT',
				exportName: 'complexEndpoint',
				tier: 'standard',
				features: createFeatures({
					hasAuth: true,
					hasServices: true,
					hasDatabase: true,
					hasBodyValidation: true,
					hasQueryValidation: true,
					hasParamValidation: true,
					hasEvents: true,
				}),
			});

			const result = generateStandardHandler(analysis);

			expect(result).toContain('getSession');
			expect(result).toContain('serviceDiscovery.register');
			expect(result).toContain('databaseService');
			expect(result).toContain("(c.req.valid as any)('json')");
			expect(result).toContain("(c.req.valid as any)('query')");
			expect(result).toContain("(c.req.valid as any)('param')");
			expect(result).toContain('publishConstructEvents');
		});

		it('should generate handler with output validation', () => {
			const analysis = createAnalysis({
				route: '/api/data',
				method: 'GET',
				exportName: 'dataEndpoint',
				tier: 'standard',
				features: createFeatures({
					hasServices: true,
					hasOutputValidation: true,
				}),
			});

			const result = generateStandardHandler(analysis);

			expect(result).toContain('outputSchema');
			expect(result).toContain('parseOutput(data)');
		});
	});

	describe('generateOptimizedSetupFunction', () => {
		it('should generate setup function with only minimal endpoints', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
			];

			const result = generateOptimizedSetupFunction(analyses, [
				'healthEndpoint',
			]);

			expect(result).toContain('export async function setupEndpoints');
			expect(result).toContain('Minimal handlers (1 endpoints)');
			expect(result).toContain('Standard handlers (0 endpoints)');
			expect(result).toContain("app.get('/health'");
			expect(result).not.toContain('HonoEndpoint.addRoutes');
		});

		it('should generate setup function with full endpoints', () => {
			const analyses = [
				createAnalysis({
					route: '/api/audit',
					method: 'POST',
					exportName: 'auditEndpoint',
					tier: 'full',
					features: createFeatures({ hasAudits: true }),
				}),
			];

			const result = generateOptimizedSetupFunction(analyses, [
				'auditEndpoint',
			]);

			expect(result).toContain('import { HonoEndpoint }');
			expect(result).toContain('HonoEndpoint.addRoutes');
			expect(result).toContain('auditEndpoint');
			expect(result).toContain('openApiOptions');
		});

		it('should generate setup function with mixed tiers', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
				createAnalysis({
					route: '/api/users',
					method: 'GET',
					exportName: 'usersEndpoint',
					tier: 'standard',
					features: createFeatures({ hasAuth: true }),
				}),
				createAnalysis({
					route: '/api/audit',
					method: 'POST',
					exportName: 'auditEndpoint',
					tier: 'full',
					features: createFeatures({ hasAudits: true }),
				}),
			];

			const result = generateOptimizedSetupFunction(analyses, [
				'healthEndpoint',
				'usersEndpoint',
				'auditEndpoint',
			]);

			expect(result).toContain('Minimal handlers (1 endpoints)');
			expect(result).toContain('Standard handlers (1 endpoints)');
			expect(result).toContain("app.get('/health'");
			expect(result).toContain("app.get('/api/users'");
			expect(result).toContain('HonoEndpoint.addRoutes');
		});

		it('should add swagger UI setup when enableOpenApi', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
			];

			const result = generateOptimizedSetupFunction(analyses, [
				'healthEndpoint',
			]);

			expect(result).toContain('if (enableOpenApi)');
			expect(result).toContain('swaggerUI');
			expect(result).toContain('/__docs/ui');
		});
	});

	describe('generateOptimizedEndpointsFile', () => {
		it('should generate complete file with all sections', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
				createAnalysis({
					route: '/api/users',
					method: 'POST',
					exportName: 'createUserEndpoint',
					tier: 'standard',
					features: createFeatures({ hasAuth: true, hasBodyValidation: true }),
				}),
			];

			const endpointImports = `import { healthEndpoint } from './endpoints/health';\nimport { createUserEndpoint } from './endpoints/users';`;

			const result = generateOptimizedEndpointsFile(analyses, endpointImports, [
				'healthEndpoint',
				'createUserEndpoint',
			]);

			expect(result).toContain('Generated optimized endpoints file');
			expect(result).toContain('minimal: 1 endpoints');
			expect(result).toContain('standard: 1 endpoints');
			expect(result).toContain('full: 0 endpoints');
			expect(result).toContain('import type { EnvironmentParser }');
			expect(result).toContain('import { healthEndpoint }');
			expect(result).toContain('import { createUserEndpoint }');
			expect(result).toContain('validateBody');
			expect(result).toContain('export async function setupEndpoints');
		});

		it('should not generate validator factories when not needed', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
			];

			const result = generateOptimizedEndpointsFile(
				analyses,
				"import { healthEndpoint } from './endpoints/health';",
				['healthEndpoint'],
			);

			expect(result).not.toContain('validateBody');
			expect(result).not.toContain('validateQuery');
			expect(result).not.toContain('validateParams');
		});
	});

	describe('generateEndpointFilesByTier', () => {
		it('should generate all required files', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
			];

			const endpointImports = [
				{ exportName: 'healthEndpoint', importPath: '../endpoints/health' },
			];

			const files = generateEndpointFilesByTier(analyses, endpointImports);

			expect(files).toHaveProperty('validators.ts');
			expect(files).toHaveProperty('minimal.ts');
			expect(files).toHaveProperty('standard.ts');
			expect(files).toHaveProperty('full.ts');
			expect(files).toHaveProperty('index.ts');
		});

		it('should generate validators file with needed validators', () => {
			const analyses = [
				createAnalysis({
					route: '/api/users',
					method: 'POST',
					exportName: 'createUserEndpoint',
					tier: 'minimal',
					features: createFeatures({ hasBodyValidation: true }),
				}),
			];

			const endpointImports = [
				{ exportName: 'createUserEndpoint', importPath: '../endpoints/users' },
			];

			const files = generateEndpointFilesByTier(analyses, endpointImports);

			expect(files['validators.ts']).toContain('export const validateBody');
			expect(files['validators.ts']).toContain("validator('json'");
		});

		it('should generate empty validators file when no validation needed', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
			];

			const endpointImports = [
				{ exportName: 'healthEndpoint', importPath: '../endpoints/health' },
			];

			const files = generateEndpointFilesByTier(analyses, endpointImports);

			expect(files['validators.ts']).toContain('No validators needed');
			expect(files['validators.ts']).toContain('export {}');
		});

		it('should generate minimal file with handlers', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
			];

			const endpointImports = [
				{ exportName: 'healthEndpoint', importPath: '../endpoints/health' },
			];

			const files = generateEndpointFilesByTier(analyses, endpointImports);

			expect(files['minimal.ts']).toContain('Minimal-tier endpoint handlers');
			expect(files['minimal.ts']).toContain('1 endpoints');
			expect(files['minimal.ts']).toContain(
				'export function setupMinimalEndpoints',
			);
			expect(files['minimal.ts']).toContain('import { healthEndpoint }');
			expect(files['minimal.ts']).toContain("app.get('/health'");
		});

		it('should generate empty minimal file when no minimal endpoints', () => {
			const analyses = [
				createAnalysis({
					route: '/api/users',
					method: 'GET',
					exportName: 'usersEndpoint',
					tier: 'standard',
					features: createFeatures({ hasAuth: true }),
				}),
			];

			const endpointImports = [
				{ exportName: 'usersEndpoint', importPath: '../endpoints/users' },
			];

			const files = generateEndpointFilesByTier(analyses, endpointImports);

			expect(files['minimal.ts']).toContain('No minimal-tier endpoints');
			expect(files['minimal.ts']).toContain('_app: Hono');
		});

		it('should generate standard file with handlers', () => {
			const analyses = [
				createAnalysis({
					route: '/api/users',
					method: 'GET',
					exportName: 'usersEndpoint',
					tier: 'standard',
					features: createFeatures({ hasAuth: true }),
				}),
			];

			const endpointImports = [
				{ exportName: 'usersEndpoint', importPath: '../endpoints/users' },
			];

			const files = generateEndpointFilesByTier(analyses, endpointImports);

			expect(files['standard.ts']).toContain('Standard-tier endpoint handlers');
			expect(files['standard.ts']).toContain('1 endpoints');
			expect(files['standard.ts']).toContain(
				'export function setupStandardEndpoints',
			);
			expect(files['standard.ts']).toContain('import { usersEndpoint }');
		});

		it('should generate standard file with events import when needed', () => {
			const analyses = [
				createAnalysis({
					route: '/api/orders',
					method: 'POST',
					exportName: 'createOrderEndpoint',
					tier: 'standard',
					features: createFeatures({ hasEvents: true }),
				}),
			];

			const endpointImports = [
				{
					exportName: 'createOrderEndpoint',
					importPath: '../endpoints/orders',
				},
			];

			const files = generateEndpointFilesByTier(analyses, endpointImports);

			expect(files['standard.ts']).toContain(
				'import { publishConstructEvents }',
			);
		});

		it('should generate full file with HonoEndpoint', () => {
			const analyses = [
				createAnalysis({
					route: '/api/audit',
					method: 'POST',
					exportName: 'auditEndpoint',
					tier: 'full',
					features: createFeatures({ hasAudits: true }),
				}),
			];

			const endpointImports = [
				{ exportName: 'auditEndpoint', importPath: '../endpoints/audit' },
			];

			const files = generateEndpointFilesByTier(analyses, endpointImports);

			expect(files['full.ts']).toContain('Full-tier endpoint handlers');
			expect(files['full.ts']).toContain('import { HonoEndpoint }');
			expect(files['full.ts']).toContain('HonoEndpoint.addRoutes');
			expect(files['full.ts']).toContain('import { auditEndpoint }');
		});

		it('should generate empty full file when no full endpoints', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
			];

			const endpointImports = [
				{ exportName: 'healthEndpoint', importPath: '../endpoints/health' },
			];

			const files = generateEndpointFilesByTier(analyses, endpointImports);

			expect(files['full.ts']).toContain('No full-tier endpoints');
		});

		it('should generate index file with correct counts', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
				createAnalysis({
					route: '/api/users',
					method: 'GET',
					exportName: 'usersEndpoint',
					tier: 'standard',
					features: createFeatures({ hasAuth: true }),
				}),
				createAnalysis({
					route: '/api/audit',
					method: 'POST',
					exportName: 'auditEndpoint',
					tier: 'full',
					features: createFeatures({ hasAudits: true }),
				}),
			];

			const endpointImports = [
				{ exportName: 'healthEndpoint', importPath: '../endpoints/health' },
				{ exportName: 'usersEndpoint', importPath: '../endpoints/users' },
				{ exportName: 'auditEndpoint', importPath: '../endpoints/audit' },
			];

			const files = generateEndpointFilesByTier(analyses, endpointImports);

			expect(files['index.ts']).toContain('minimal: 1 endpoints');
			expect(files['index.ts']).toContain('standard: 1 endpoints');
			expect(files['index.ts']).toContain('full: 1 endpoints');
			expect(files['index.ts']).toContain('import { setupMinimalEndpoints }');
			expect(files['index.ts']).toContain('import { setupStandardEndpoints }');
			expect(files['index.ts']).toContain('import { setupFullEndpoints }');
			expect(files['index.ts']).toContain(
				'export async function setupEndpoints',
			);
		});

		it('should include validator imports in minimal file when needed', () => {
			const analyses = [
				createAnalysis({
					route: '/api/users',
					method: 'POST',
					exportName: 'createUserEndpoint',
					tier: 'minimal',
					features: createFeatures({ hasBodyValidation: true }),
				}),
			];

			const endpointImports = [
				{ exportName: 'createUserEndpoint', importPath: '../endpoints/users' },
			];

			const files = generateEndpointFilesByTier(analyses, endpointImports);

			expect(files['minimal.ts']).toContain(
				"import { validateBody } from './validators.js'",
			);
		});

		it('should include validator imports in standard file when needed', () => {
			const analyses = [
				createAnalysis({
					route: '/api/users',
					method: 'POST',
					exportName: 'createUserEndpoint',
					tier: 'standard',
					features: createFeatures({ hasAuth: true, hasBodyValidation: true }),
				}),
			];

			const endpointImports = [
				{ exportName: 'createUserEndpoint', importPath: '../endpoints/users' },
			];

			const files = generateEndpointFilesByTier(analyses, endpointImports);

			expect(files['standard.ts']).toContain(
				"import { validateBody } from './validators.js'",
			);
		});
	});

	describe('generateEndpointFilesNested', () => {
		it('should generate base files', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
			];

			const endpointImports = [
				{ exportName: 'healthEndpoint', importPath: '../../endpoints/health' },
			];

			const files = generateEndpointFilesNested(analyses, endpointImports);

			expect(files).toHaveProperty('validators.ts');
			expect(files).toHaveProperty('minimal/index.ts');
			expect(files).toHaveProperty('standard/index.ts');
			expect(files).toHaveProperty('full/index.ts');
			expect(files).toHaveProperty('index.ts');
		});

		it('should generate individual endpoint files for minimal tier', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
			];

			const endpointImports = [
				{ exportName: 'healthEndpoint', importPath: '../../endpoints/health' },
			];

			const files = generateEndpointFilesNested(analyses, endpointImports);

			expect(files).toHaveProperty('minimal/healthEndpoint.ts');
			expect(files['minimal/healthEndpoint.ts']).toContain('Minimal endpoint: /health (GET)');
			expect(files['minimal/healthEndpoint.ts']).toContain('export function setupHealthEndpoint');
			expect(files['minimal/healthEndpoint.ts']).toContain("import { healthEndpoint }");
		});

		it('should generate individual endpoint files for standard tier', () => {
			const analyses = [
				createAnalysis({
					route: '/api/users',
					method: 'GET',
					exportName: 'usersEndpoint',
					tier: 'standard',
					features: createFeatures({ hasAuth: true }),
				}),
			];

			const endpointImports = [
				{ exportName: 'usersEndpoint', importPath: '../../endpoints/users' },
			];

			const files = generateEndpointFilesNested(analyses, endpointImports);

			expect(files).toHaveProperty('standard/usersEndpoint.ts');
			expect(files['standard/usersEndpoint.ts']).toContain('Standard endpoint: /api/users (GET)');
			expect(files['standard/usersEndpoint.ts']).toContain('export function setupUsersEndpoint');
			expect(files['standard/usersEndpoint.ts']).toContain("import { usersEndpoint }");
		});

		it('should generate individual endpoint files for full tier', () => {
			const analyses = [
				createAnalysis({
					route: '/api/audit',
					method: 'POST',
					exportName: 'auditEndpoint',
					tier: 'full',
					features: createFeatures({ hasAudits: true }),
				}),
			];

			const endpointImports = [
				{ exportName: 'auditEndpoint', importPath: '../../endpoints/audit' },
			];

			const files = generateEndpointFilesNested(analyses, endpointImports);

			expect(files).toHaveProperty('full/auditEndpoint.ts');
			expect(files['full/auditEndpoint.ts']).toContain('Full endpoint: /api/audit (POST)');
			expect(files['full/auditEndpoint.ts']).toContain('export function setupAuditEndpoint');
			expect(files['full/auditEndpoint.ts']).toContain('import { HonoEndpoint }');
		});

		it('should generate tier index files that import individual endpoints', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
				createAnalysis({
					route: '/ready',
					method: 'GET',
					exportName: 'readyEndpoint',
					tier: 'minimal',
				}),
			];

			const endpointImports = [
				{ exportName: 'healthEndpoint', importPath: '../../endpoints/health' },
				{ exportName: 'readyEndpoint', importPath: '../../endpoints/ready' },
			];

			const files = generateEndpointFilesNested(analyses, endpointImports);

			expect(files['minimal/index.ts']).toContain("import { setupHealthEndpoint } from './healthEndpoint.js'");
			expect(files['minimal/index.ts']).toContain("import { setupReadyEndpoint } from './readyEndpoint.js'");
			expect(files['minimal/index.ts']).toContain('setupHealthEndpoint(app, logger)');
			expect(files['minimal/index.ts']).toContain('setupReadyEndpoint(app, logger)');
		});

		it('should generate empty tier index for tiers with no endpoints', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
			];

			const endpointImports = [
				{ exportName: 'healthEndpoint', importPath: '../../endpoints/health' },
			];

			const files = generateEndpointFilesNested(analyses, endpointImports);

			expect(files['standard/index.ts']).toContain('No standard-tier endpoints');
			expect(files['full/index.ts']).toContain('No full-tier endpoints');
		});

		it('should generate nested index file with correct imports', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
			];

			const endpointImports = [
				{ exportName: 'healthEndpoint', importPath: '../../endpoints/health' },
			];

			const files = generateEndpointFilesNested(analyses, endpointImports);

			expect(files['index.ts']).toContain("import { setupMinimalEndpoints } from './minimal/index.js'");
			expect(files['index.ts']).toContain("import { setupStandardEndpoints } from './standard/index.js'");
			expect(files['index.ts']).toContain("import { setupFullEndpoints } from './full/index.js'");
		});

		it('should include validator imports in individual endpoint files when needed', () => {
			const analyses = [
				createAnalysis({
					route: '/api/users',
					method: 'POST',
					exportName: 'createUserEndpoint',
					tier: 'minimal',
					features: createFeatures({ hasBodyValidation: true }),
				}),
			];

			const endpointImports = [
				{ exportName: 'createUserEndpoint', importPath: '../../endpoints/users' },
			];

			const files = generateEndpointFilesNested(analyses, endpointImports);

			expect(files['minimal/createUserEndpoint.ts']).toContain("import { validateBody } from '../validators.js'");
		});

		it('should include events import in standard endpoint files when needed', () => {
			const analyses = [
				createAnalysis({
					route: '/api/orders',
					method: 'POST',
					exportName: 'createOrderEndpoint',
					tier: 'standard',
					features: createFeatures({ hasEvents: true }),
				}),
			];

			const endpointImports = [
				{ exportName: 'createOrderEndpoint', importPath: '../../endpoints/orders' },
			];

			const files = generateEndpointFilesNested(analyses, endpointImports);

			expect(files['standard/createOrderEndpoint.ts']).toContain('import { publishConstructEvents }');
		});

		it('should skip endpoints without matching imports', () => {
			const analyses = [
				createAnalysis({
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
				}),
				createAnalysis({
					route: '/unknown',
					method: 'GET',
					exportName: 'unknownEndpoint',
					tier: 'minimal',
				}),
			];

			// Only provide import for healthEndpoint
			const endpointImports = [
				{ exportName: 'healthEndpoint', importPath: '../../endpoints/health' },
			];

			const files = generateEndpointFilesNested(analyses, endpointImports);

			expect(files).toHaveProperty('minimal/healthEndpoint.ts');
			expect(files).not.toHaveProperty('minimal/unknownEndpoint.ts');
		});

		it('should generate standard tier index with correct function calls', () => {
			const analyses = [
				createAnalysis({
					route: '/api/users',
					method: 'GET',
					exportName: 'usersEndpoint',
					tier: 'standard',
					features: createFeatures({ hasAuth: true }),
				}),
			];

			const endpointImports = [
				{ exportName: 'usersEndpoint', importPath: '../../endpoints/users' },
			];

			const files = generateEndpointFilesNested(analyses, endpointImports);

			expect(files['standard/index.ts']).toContain('setupUsersEndpoint(app, serviceDiscovery, logger)');
		});

		it('should generate full tier index with correct function calls', () => {
			const analyses = [
				createAnalysis({
					route: '/api/audit',
					method: 'POST',
					exportName: 'auditEndpoint',
					tier: 'full',
					features: createFeatures({ hasAudits: true }),
				}),
			];

			const endpointImports = [
				{ exportName: 'auditEndpoint', importPath: '../../endpoints/audit' },
			];

			const files = generateEndpointFilesNested(analyses, endpointImports);

			expect(files['full/index.ts']).toContain('setupAuditEndpoint(app, serviceDiscovery, openApiOptions)');
			expect(files['full/index.ts']).toContain('const openApiOptions');
		});
	});
});
