import { describe, expect, it } from 'vitest';
import type { EndpointAnalysis, EndpointFeatures } from '../endpoint-analyzer';
import {
	generateOptimizedImports,
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

			expect(result).toContain("import type { EnvironmentParser }");
			expect(result).toContain("import type { Logger }");
			expect(result).toContain("import type { Hono }");
			expect(result).toContain("import { Endpoint }");
		});

		it('should include validator import when body validation needed', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasBodyValidation: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain("import { validator }");
		});

		it('should include validator import when query validation needed', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasQueryValidation: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain("import { validator }");
		});

		it('should include validator import when param validation needed', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasParamValidation: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain("import { validator }");
		});

		it('should include ResponseBuilder for standard tier', () => {
			const analyses = [
				createAnalysis({
					tier: 'standard',
					features: createFeatures({ hasAuth: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain("import { ResponseBuilder }");
		});

		it('should include ResponseBuilder for full tier', () => {
			const analyses = [
				createAnalysis({
					tier: 'full',
					features: createFeatures({ hasAudits: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain("import { ResponseBuilder }");
		});

		it('should include ServiceDiscovery when services are used', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasServices: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain("import { ServiceDiscovery }");
		});

		it('should include ServiceDiscovery when database is used', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasDatabase: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain("import { ServiceDiscovery }");
		});

		it('should include events import when events are used', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasEvents: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain("import { publishConstructEvents }");
		});

		it('should include audit imports when audits are used', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasAudits: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain("createAuditContext");
			expect(result).toContain("withAuditableEndpointTransaction");
		});

		it('should include createError when rate limiting is used', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasRateLimit: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain("import { createError }");
		});

		it('should include RLS imports when RLS is used', () => {
			const analyses = [
				createAnalysis({
					features: createFeatures({ hasRls: true }),
				}),
			];

			const result = generateOptimizedImports(analyses);
			expect(result).toContain("withRlsContext");
			expect(result).toContain("extractRlsContext");
		});

		it('should not include optional imports when not needed', () => {
			const analyses = [createAnalysis()];

			const result = generateOptimizedImports(analyses);
			expect(result).not.toContain("import { validator }");
			expect(result).not.toContain("ServiceDiscovery");
			expect(result).not.toContain("publishConstructEvents");
			expect(result).not.toContain("createAuditContext");
			expect(result).not.toContain("createError");
			expect(result).not.toContain("withRlsContext");
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
});
