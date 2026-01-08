import { describe, expect, it } from 'vitest';
import {
	buildOpenApiSchema,
	type ComponentCollector,
	createComponentCollector,
} from '../openapi';

describe('OpenAPI Schema', () => {
	describe('createComponentCollector', () => {
		it('should create a component collector', () => {
			const collector = createComponentCollector();

			expect(collector).toHaveProperty('schemas');
			expect(collector).toHaveProperty('addSchema');
			expect(collector).toHaveProperty('getReference');
			expect(collector.schemas).toEqual({});
		});

		it('should add schema to collector', () => {
			const collector = createComponentCollector();

			collector.addSchema('User', {
				type: 'object',
				properties: {
					name: { type: 'string' },
				},
			});

			expect(collector.schemas).toHaveProperty('User');
			expect(collector.schemas.User).toEqual({
				type: 'object',
				properties: {
					name: { type: 'string' },
				},
			});
		});

		it('should get reference to schema', () => {
			const collector = createComponentCollector();

			const reference = collector.getReference('User');

			expect(reference).toEqual({ $ref: '#/components/schemas/User' });
		});

		it('should add multiple schemas', () => {
			const collector = createComponentCollector();

			collector.addSchema('User', {
				type: 'object',
				properties: { name: { type: 'string' } },
			});

			collector.addSchema('Post', {
				type: 'object',
				properties: { title: { type: 'string' } },
			});

			expect(Object.keys(collector.schemas)).toHaveLength(2);
			expect(collector.schemas).toHaveProperty('User');
			expect(collector.schemas).toHaveProperty('Post');
		});

		it('should overwrite existing schema with same name', () => {
			const collector = createComponentCollector();

			collector.addSchema('User', {
				type: 'object',
				properties: { name: { type: 'string' } },
			});

			collector.addSchema('User', {
				type: 'object',
				properties: { email: { type: 'string' } },
			});

			expect(collector.schemas.User.properties).toHaveProperty('email');
			expect(collector.schemas.User.properties).not.toHaveProperty('name');
		});

		it('should handle complex nested schemas', () => {
			const collector = createComponentCollector();

			collector.addSchema('User', {
				type: 'object',
				properties: {
					name: { type: 'string' },
					address: {
						type: 'object',
						properties: {
							street: { type: 'string' },
							city: { type: 'string' },
						},
					},
				},
			});

			expect(collector.schemas.User.properties?.address).toBeDefined();
		});
	});

	describe('buildOpenApiSchema', () => {
		it('should build OpenAPI schema with default options', async () => {
			const mockEndpoint = {
				async toOpenApi3Route(collector?: ComponentCollector) {
					return {
						'/users': {
							get: {
								operationId: 'getUsers',
								responses: {
									'200': {
										description: 'Success',
									},
								},
							},
						},
					};
				},
			};

			const doc = await buildOpenApiSchema([mockEndpoint]);

			expect(doc).toHaveProperty('openapi', '3.0.0');
			expect(doc).toHaveProperty('info');
			expect(doc.info).toEqual({
				title: 'API',
				version: '1.0.0',
			});
			expect(doc).toHaveProperty('paths');
			expect(doc.paths).toHaveProperty('/users');
		});

		it('should build OpenAPI schema with custom options', async () => {
			const mockEndpoint = {
				async toOpenApi3Route(collector?: ComponentCollector) {
					return {
						'/posts': {
							get: {
								operationId: 'getPosts',
								responses: {
									'200': {
										description: 'Success',
									},
								},
							},
						},
					};
				},
			};

			const doc = await buildOpenApiSchema([mockEndpoint], {
				title: 'My API',
				version: '2.0.0',
				description: 'API Description',
			});

			expect(doc.info).toEqual({
				title: 'My API',
				version: '2.0.0',
				description: 'API Description',
			});
		});

		it('should merge multiple endpoints into paths', async () => {
			const endpoint1 = {
				async toOpenApi3Route(collector?: ComponentCollector) {
					return {
						'/users': {
							get: {
								operationId: 'getUsers',
								responses: { '200': { description: 'Success' } },
							},
						},
					};
				},
			};

			const endpoint2 = {
				async toOpenApi3Route(collector?: ComponentCollector) {
					return {
						'/posts': {
							get: {
								operationId: 'getPosts',
								responses: { '200': { description: 'Success' } },
							},
						},
					};
				},
			};

			const doc = await buildOpenApiSchema([endpoint1, endpoint2]);

			expect(Object.keys(doc.paths)).toHaveLength(2);
			expect(doc.paths).toHaveProperty('/users');
			expect(doc.paths).toHaveProperty('/posts');
		});

		it('should merge multiple methods for same path', async () => {
			const endpoint1 = {
				async toOpenApi3Route(collector?: ComponentCollector) {
					return {
						'/users': {
							get: {
								operationId: 'getUsers',
								responses: { '200': { description: 'Success' } },
							},
						},
					};
				},
			};

			const endpoint2 = {
				async toOpenApi3Route(collector?: ComponentCollector) {
					return {
						'/users': {
							post: {
								operationId: 'createUser',
								responses: { '201': { description: 'Created' } },
							},
						},
					};
				},
			};

			const doc = await buildOpenApiSchema([endpoint1, endpoint2]);

			expect(doc.paths['/users']).toHaveProperty('get');
			expect(doc.paths['/users']).toHaveProperty('post');
		});

		it('should add components when schemas are collected', async () => {
			const mockEndpoint = {
				async toOpenApi3Route(collector?: ComponentCollector) {
					if (collector) {
						collector.addSchema('User', {
							type: 'object',
							properties: {
								name: { type: 'string' },
							},
						});
					}

					return {
						'/users': {
							get: {
								operationId: 'getUsers',
								responses: {
									'200': {
										description: 'Success',
										content: {
											'application/json': {
												schema: collector?.getReference('User'),
											},
										},
									},
								},
							},
						},
					};
				},
			};

			const doc = await buildOpenApiSchema([mockEndpoint]);

			expect(doc).toHaveProperty('components');
			expect(doc.components).toHaveProperty('schemas');
			expect(doc.components?.schemas).toHaveProperty('User');
		});

		it('should not add components when no schemas collected', async () => {
			const mockEndpoint = {
				async toOpenApi3Route(collector?: ComponentCollector) {
					return {
						'/health': {
							get: {
								operationId: 'healthCheck',
								responses: {
									'200': {
										description: 'Healthy',
									},
								},
							},
						},
					};
				},
			};

			const doc = await buildOpenApiSchema([mockEndpoint]);

			expect(doc).not.toHaveProperty('components');
		});

		it('should handle empty endpoints array', async () => {
			const doc = await buildOpenApiSchema([]);

			expect(doc.paths).toEqual({});
			expect(doc).not.toHaveProperty('components');
		});

		it('should handle endpoints with parameters', async () => {
			const mockEndpoint = {
				async toOpenApi3Route(collector?: ComponentCollector) {
					return {
						'/users/{id}': {
							get: {
								operationId: 'getUserById',
								parameters: [
									{
										name: 'id',
										in: 'path',
										required: true,
										schema: { type: 'string' },
									},
								],
								responses: {
									'200': {
										description: 'Success',
									},
								},
							},
						},
					};
				},
			};

			const doc = await buildOpenApiSchema([mockEndpoint]);

			expect(doc.paths['/users/{id}']?.get?.parameters).toBeDefined();
			expect(doc.paths['/users/{id}']?.get?.parameters).toHaveLength(1);
		});

		it('should handle endpoints with request body', async () => {
			const mockEndpoint = {
				async toOpenApi3Route(collector?: ComponentCollector) {
					return {
						'/users': {
							post: {
								operationId: 'createUser',
								requestBody: {
									required: true,
									content: {
										'application/json': {
											schema: {
												type: 'object',
												properties: {
													name: { type: 'string' },
												},
											},
										},
									},
								},
								responses: {
									'201': {
										description: 'Created',
									},
								},
							},
						},
					};
				},
			};

			const doc = await buildOpenApiSchema([mockEndpoint]);

			expect(doc.paths['/users']?.post?.requestBody).toBeDefined();
		});

		it('should handle endpoints with multiple response codes', async () => {
			const mockEndpoint = {
				async toOpenApi3Route(collector?: ComponentCollector) {
					return {
						'/users': {
							get: {
								operationId: 'getUsers',
								responses: {
									'200': { description: 'Success' },
									'400': { description: 'Bad Request' },
									'401': { description: 'Unauthorized' },
									'500': { description: 'Server Error' },
								},
							},
						},
					};
				},
			};

			const doc = await buildOpenApiSchema([mockEndpoint]);

			const responses = doc.paths['/users']?.get?.responses;
			expect(responses).toHaveProperty('200');
			expect(responses).toHaveProperty('400');
			expect(responses).toHaveProperty('401');
			expect(responses).toHaveProperty('500');
		});
	});
});
