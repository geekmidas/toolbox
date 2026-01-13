import { describe, expect, it } from 'vitest';
import {
	analyzeEndpointFeatures,
	determineEndpointTier,
	summarizeAnalysis,
	type EndpointAnalysis,
	type EndpointFeatures,
} from '../endpoint-analyzer';

describe('endpoint-analyzer', () => {
	describe('analyzeEndpointFeatures', () => {
		it('should detect auth when authorizer is set', () => {
			const endpoint = {
				authorizer: () => true,
				services: [],
				databaseService: undefined,
				input: {},
				audits: [],
				events: [],
				rateLimit: undefined,
				rlsConfig: undefined,
				rlsBypass: false,
				outputSchema: undefined,
			};

			const features = analyzeEndpointFeatures(endpoint as any);
			expect(features.hasAuth).toBe(true);
		});

		it('should detect services when services array is not empty', () => {
			const endpoint = {
				authorizer: undefined,
				services: [{ serviceName: 'db' }],
				databaseService: undefined,
				input: {},
				audits: [],
				events: [],
				rateLimit: undefined,
				rlsConfig: undefined,
				rlsBypass: false,
				outputSchema: undefined,
			};

			const features = analyzeEndpointFeatures(endpoint as any);
			expect(features.hasServices).toBe(true);
		});

		it('should detect database service when set', () => {
			const endpoint = {
				authorizer: undefined,
				services: [],
				databaseService: { serviceName: 'database' },
				input: {},
				audits: [],
				events: [],
				rateLimit: undefined,
				rlsConfig: undefined,
				rlsBypass: false,
				outputSchema: undefined,
			};

			const features = analyzeEndpointFeatures(endpoint as any);
			expect(features.hasDatabase).toBe(true);
		});

		it('should detect body validation', () => {
			const endpoint = {
				authorizer: undefined,
				services: [],
				databaseService: undefined,
				input: { body: { parse: () => {} } },
				audits: [],
				events: [],
				rateLimit: undefined,
				rlsConfig: undefined,
				rlsBypass: false,
				outputSchema: undefined,
			};

			const features = analyzeEndpointFeatures(endpoint as any);
			expect(features.hasBodyValidation).toBe(true);
		});

		it('should detect query validation', () => {
			const endpoint = {
				authorizer: undefined,
				services: [],
				databaseService: undefined,
				input: { query: { parse: () => {} } },
				audits: [],
				events: [],
				rateLimit: undefined,
				rlsConfig: undefined,
				rlsBypass: false,
				outputSchema: undefined,
			};

			const features = analyzeEndpointFeatures(endpoint as any);
			expect(features.hasQueryValidation).toBe(true);
		});

		it('should detect param validation', () => {
			const endpoint = {
				authorizer: undefined,
				services: [],
				databaseService: undefined,
				input: { params: { parse: () => {} } },
				audits: [],
				events: [],
				rateLimit: undefined,
				rlsConfig: undefined,
				rlsBypass: false,
				outputSchema: undefined,
			};

			const features = analyzeEndpointFeatures(endpoint as any);
			expect(features.hasParamValidation).toBe(true);
		});

		it('should detect audits when audits array is not empty', () => {
			const endpoint = {
				authorizer: undefined,
				services: [],
				databaseService: undefined,
				input: {},
				audits: [{ type: 'user.created' }],
				events: [],
				rateLimit: undefined,
				rlsConfig: undefined,
				rlsBypass: false,
				outputSchema: undefined,
			};

			const features = analyzeEndpointFeatures(endpoint as any);
			expect(features.hasAudits).toBe(true);
		});

		it('should detect events when events array is not empty', () => {
			const endpoint = {
				authorizer: undefined,
				services: [],
				databaseService: undefined,
				input: {},
				audits: [],
				events: [{ type: 'user.created' }],
				rateLimit: undefined,
				rlsConfig: undefined,
				rlsBypass: false,
				outputSchema: undefined,
			};

			const features = analyzeEndpointFeatures(endpoint as any);
			expect(features.hasEvents).toBe(true);
		});

		it('should detect rate limiting', () => {
			const endpoint = {
				authorizer: undefined,
				services: [],
				databaseService: undefined,
				input: {},
				audits: [],
				events: [],
				rateLimit: { limit: 100, windowMs: 60000 },
				rlsConfig: undefined,
				rlsBypass: false,
				outputSchema: undefined,
			};

			const features = analyzeEndpointFeatures(endpoint as any);
			expect(features.hasRateLimit).toBe(true);
		});

		it('should detect RLS when rlsConfig is set and not bypassed', () => {
			const endpoint = {
				authorizer: undefined,
				services: [],
				databaseService: undefined,
				input: {},
				audits: [],
				events: [],
				rateLimit: undefined,
				rlsConfig: { role: 'authenticated' },
				rlsBypass: false,
				outputSchema: undefined,
			};

			const features = analyzeEndpointFeatures(endpoint as any);
			expect(features.hasRls).toBe(true);
		});

		it('should not detect RLS when bypassed', () => {
			const endpoint = {
				authorizer: undefined,
				services: [],
				databaseService: undefined,
				input: {},
				audits: [],
				events: [],
				rateLimit: undefined,
				rlsConfig: { role: 'authenticated' },
				rlsBypass: true,
				outputSchema: undefined,
			};

			const features = analyzeEndpointFeatures(endpoint as any);
			expect(features.hasRls).toBe(false);
		});

		it('should detect output validation', () => {
			const endpoint = {
				authorizer: undefined,
				services: [],
				databaseService: undefined,
				input: {},
				audits: [],
				events: [],
				rateLimit: undefined,
				rlsConfig: undefined,
				rlsBypass: false,
				outputSchema: { parse: () => {} },
			};

			const features = analyzeEndpointFeatures(endpoint as any);
			expect(features.hasOutputValidation).toBe(true);
		});

		it('should handle minimal endpoint with no features', () => {
			const endpoint = {
				authorizer: undefined,
				services: [],
				databaseService: undefined,
				input: {},
				audits: [],
				events: [],
				rateLimit: undefined,
				rlsConfig: undefined,
				rlsBypass: false,
				outputSchema: undefined,
			};

			const features = analyzeEndpointFeatures(endpoint as any);
			expect(features).toEqual({
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
			});
		});
	});

	describe('determineEndpointTier', () => {
		it('should return minimal for endpoint with no features', () => {
			const features: EndpointFeatures = {
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
			};

			expect(determineEndpointTier(features)).toBe('minimal');
		});

		it('should return minimal for endpoint with only validation', () => {
			const features: EndpointFeatures = {
				hasAuth: false,
				hasServices: false,
				hasDatabase: false,
				hasBodyValidation: true,
				hasQueryValidation: true,
				hasParamValidation: true,
				hasAudits: false,
				hasEvents: false,
				hasRateLimit: false,
				hasRls: false,
				hasOutputValidation: true,
			};

			expect(determineEndpointTier(features)).toBe('minimal');
		});

		it('should return standard for endpoint with auth', () => {
			const features: EndpointFeatures = {
				hasAuth: true,
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
			};

			expect(determineEndpointTier(features)).toBe('standard');
		});

		it('should return standard for endpoint with services', () => {
			const features: EndpointFeatures = {
				hasAuth: false,
				hasServices: true,
				hasDatabase: false,
				hasBodyValidation: false,
				hasQueryValidation: false,
				hasParamValidation: false,
				hasAudits: false,
				hasEvents: false,
				hasRateLimit: false,
				hasRls: false,
				hasOutputValidation: false,
			};

			expect(determineEndpointTier(features)).toBe('standard');
		});

		it('should return standard for endpoint with database', () => {
			const features: EndpointFeatures = {
				hasAuth: false,
				hasServices: false,
				hasDatabase: true,
				hasBodyValidation: false,
				hasQueryValidation: false,
				hasParamValidation: false,
				hasAudits: false,
				hasEvents: false,
				hasRateLimit: false,
				hasRls: false,
				hasOutputValidation: false,
			};

			expect(determineEndpointTier(features)).toBe('standard');
		});

		it('should return standard for endpoint with events', () => {
			const features: EndpointFeatures = {
				hasAuth: false,
				hasServices: false,
				hasDatabase: false,
				hasBodyValidation: false,
				hasQueryValidation: false,
				hasParamValidation: false,
				hasAudits: false,
				hasEvents: true,
				hasRateLimit: false,
				hasRls: false,
				hasOutputValidation: false,
			};

			expect(determineEndpointTier(features)).toBe('standard');
		});

		it('should return full for endpoint with audits', () => {
			const features: EndpointFeatures = {
				hasAuth: false,
				hasServices: false,
				hasDatabase: false,
				hasBodyValidation: false,
				hasQueryValidation: false,
				hasParamValidation: false,
				hasAudits: true,
				hasEvents: false,
				hasRateLimit: false,
				hasRls: false,
				hasOutputValidation: false,
			};

			expect(determineEndpointTier(features)).toBe('full');
		});

		it('should return full for endpoint with rate limiting', () => {
			const features: EndpointFeatures = {
				hasAuth: false,
				hasServices: false,
				hasDatabase: false,
				hasBodyValidation: false,
				hasQueryValidation: false,
				hasParamValidation: false,
				hasAudits: false,
				hasEvents: false,
				hasRateLimit: true,
				hasRls: false,
				hasOutputValidation: false,
			};

			expect(determineEndpointTier(features)).toBe('full');
		});

		it('should return full for endpoint with RLS', () => {
			const features: EndpointFeatures = {
				hasAuth: false,
				hasServices: false,
				hasDatabase: false,
				hasBodyValidation: false,
				hasQueryValidation: false,
				hasParamValidation: false,
				hasAudits: false,
				hasEvents: false,
				hasRateLimit: false,
				hasRls: true,
				hasOutputValidation: false,
			};

			expect(determineEndpointTier(features)).toBe('full');
		});

		it('should return full even with auth and services when has audits', () => {
			const features: EndpointFeatures = {
				hasAuth: true,
				hasServices: true,
				hasDatabase: true,
				hasBodyValidation: true,
				hasQueryValidation: true,
				hasParamValidation: true,
				hasAudits: true,
				hasEvents: true,
				hasRateLimit: false,
				hasRls: false,
				hasOutputValidation: true,
			};

			expect(determineEndpointTier(features)).toBe('full');
		});
	});

	describe('summarizeAnalysis', () => {
		it('should summarize empty analyses', () => {
			const result = summarizeAnalysis([]);
			expect(result).toEqual({
				total: 0,
				byTier: {
					minimal: 0,
					standard: 0,
					full: 0,
				},
				byFeature: {
					hasAuth: 0,
					hasServices: 0,
					hasDatabase: 0,
					hasBodyValidation: 0,
					hasQueryValidation: 0,
					hasParamValidation: 0,
					hasAudits: 0,
					hasEvents: 0,
					hasRateLimit: 0,
					hasRls: 0,
					hasOutputValidation: 0,
				},
			});
		});

		it('should count endpoints by tier', () => {
			const analyses: EndpointAnalysis[] = [
				{
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
					serviceNames: [],
					features: {
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
					},
				},
				{
					route: '/users',
					method: 'GET',
					exportName: 'listUsersEndpoint',
					tier: 'standard',
					serviceNames: ['database'],
					features: {
						hasAuth: true,
						hasServices: true,
						hasDatabase: true,
						hasBodyValidation: false,
						hasQueryValidation: true,
						hasParamValidation: false,
						hasAudits: false,
						hasEvents: false,
						hasRateLimit: false,
						hasRls: false,
						hasOutputValidation: false,
					},
				},
				{
					route: '/users',
					method: 'POST',
					exportName: 'createUserEndpoint',
					tier: 'full',
					serviceNames: ['database'],
					features: {
						hasAuth: true,
						hasServices: true,
						hasDatabase: true,
						hasBodyValidation: true,
						hasQueryValidation: false,
						hasParamValidation: false,
						hasAudits: true,
						hasEvents: true,
						hasRateLimit: true,
						hasRls: false,
						hasOutputValidation: true,
					},
				},
			];

			const result = summarizeAnalysis(analyses);

			expect(result.total).toBe(3);
			expect(result.byTier).toEqual({
				minimal: 1,
				standard: 1,
				full: 1,
			});
			expect(result.byFeature.hasAuth).toBe(2);
			expect(result.byFeature.hasServices).toBe(2);
			expect(result.byFeature.hasDatabase).toBe(2);
			expect(result.byFeature.hasBodyValidation).toBe(1);
			expect(result.byFeature.hasQueryValidation).toBe(1);
			expect(result.byFeature.hasAudits).toBe(1);
			expect(result.byFeature.hasEvents).toBe(1);
			expect(result.byFeature.hasRateLimit).toBe(1);
		});

		it('should count multiple endpoints of same tier', () => {
			const analyses: EndpointAnalysis[] = [
				{
					route: '/health',
					method: 'GET',
					exportName: 'healthEndpoint',
					tier: 'minimal',
					serviceNames: [],
					features: {
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
					},
				},
				{
					route: '/ping',
					method: 'GET',
					exportName: 'pingEndpoint',
					tier: 'minimal',
					serviceNames: [],
					features: {
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
					},
				},
				{
					route: '/version',
					method: 'GET',
					exportName: 'versionEndpoint',
					tier: 'minimal',
					serviceNames: [],
					features: {
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
					},
				},
			];

			const result = summarizeAnalysis(analyses);

			expect(result.total).toBe(3);
			expect(result.byTier).toEqual({
				minimal: 3,
				standard: 0,
				full: 0,
			});
		});
	});
});
