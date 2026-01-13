import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineWorkspace } from '../index.js';
import type { InferAppNames, InferredWorkspaceConfig } from '../types.js';

describe('Type Inference', () => {
	describe('defineWorkspace type inference', () => {
		it('should infer app names as literal types', () => {
			const config = defineWorkspace({
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						framework: 'nextjs',
					},
				},
			});

			// Type-level test: apps should have 'api' and 'web' as keys
			expectTypeOf(config.apps).toHaveProperty('api');
			expectTypeOf(config.apps).toHaveProperty('web');

			// Runtime test
			expect(Object.keys(config.apps)).toEqual(['api', 'web']);
		});

		it('should allow valid dependencies', () => {
			const config = defineWorkspace({
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
					},
					auth: {
						type: 'backend',
						path: 'apps/auth',
						port: 3001,
						routes: './src/**/*.ts',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3002,
						framework: 'nextjs',
						dependencies: ['api', 'auth'],
					},
				},
			});

			expect(config.apps.web.dependencies).toEqual(['api', 'auth']);
		});

		it('should throw error for invalid dependency at runtime', () => {
			expect(() =>
				defineWorkspace({
					apps: {
						api: {
							type: 'backend',
							path: 'apps/api',
							port: 3000,
							routes: './src/**/*.ts',
						},
						web: {
							type: 'frontend',
							path: 'apps/web',
							port: 3001,
							framework: 'nextjs',
							dependencies: ['nonexistent'],
						},
					},
				}),
			).toThrow(/Invalid dependency.*"nonexistent"/);
		});

		it('should throw error for self-dependency at runtime', () => {
			expect(() =>
				defineWorkspace({
					apps: {
						api: {
							type: 'backend',
							path: 'apps/api',
							port: 3000,
							routes: './src/**/*.ts',
							dependencies: ['api'],
						},
					},
				}),
			).toThrow(/cannot depend on itself/);
		});

		it('should preserve all config properties with inference', () => {
			const config = defineWorkspace({
				name: 'my-workspace',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
						envParser: './src/env',
						logger: './src/logger',
						telescope: { enabled: true, port: 9000 },
					},
				},
				services: {
					db: true,
					cache: { version: '7.2' },
				},
				deploy: {
					default: 'dokploy',
				},
			});

			expect(config.name).toBe('my-workspace');
			expect(config.apps.api.envParser).toBe('./src/env');
			expect(config.apps.api.telescope).toEqual({ enabled: true, port: 9000 });
			expect(config.services?.db).toBe(true);
			expect(config.deploy?.default).toBe('dokploy');
		});
	});

	describe('InferAppNames type utility', () => {
		it('should extract app names as union type', () => {
			type TestApps = {
				api: { path: string; port: number };
				web: { path: string; port: number };
				worker: { path: string; port: number };
			};

			type AppNames = InferAppNames<TestApps>;

			// Type-level assertion: AppNames should be 'api' | 'web' | 'worker'
			expectTypeOf<AppNames>().toEqualTypeOf<'api' | 'web' | 'worker'>();
		});
	});

	describe('InferredWorkspaceConfig type utility', () => {
		it('should create correct inferred config type', () => {
			type TestApps = {
				api: { path: string; port: number; routes: string };
				web: { path: string; port: number; framework: 'nextjs' };
			};

			type Inferred = InferredWorkspaceConfig<TestApps>;

			// The inferred type should have the same structure
			expectTypeOf<Inferred['apps']['api']>().toHaveProperty('path');
			expectTypeOf<Inferred['apps']['web']>().toHaveProperty('framework');

			// Dependencies should be typed as 'api' | 'web'
			type WebDeps = NonNullable<Inferred['apps']['web']['dependencies']>;
			expectTypeOf<WebDeps>().toEqualTypeOf<('api' | 'web')[]>();
		});
	});

	describe('Complex workspace scenarios', () => {
		it('should handle workspace with multiple backend and frontend apps', () => {
			const config = defineWorkspace({
				name: 'complex-saas',
				apps: {
					'api-gateway': {
						type: 'backend',
						path: 'apps/api-gateway',
						port: 3000,
						routes: './src/**/*.ts',
					},
					'user-service': {
						type: 'backend',
						path: 'apps/user-service',
						port: 3001,
						routes: './src/**/*.ts',
					},
					'payment-service': {
						type: 'backend',
						path: 'apps/payment-service',
						port: 3002,
						routes: './src/**/*.ts',
						dependencies: ['user-service'],
					},
					'web-app': {
						type: 'frontend',
						path: 'apps/web',
						port: 3003,
						framework: 'nextjs',
						dependencies: ['api-gateway'],
					},
					'admin-dashboard': {
						type: 'frontend',
						path: 'apps/admin',
						port: 3004,
						framework: 'nextjs',
						dependencies: ['api-gateway', 'user-service'],
					},
				},
				services: {
					db: { version: '16-alpine' },
					cache: true,
					mail: { smtp: { host: 'smtp.example.com', port: 587 } },
				},
			});

			expect(Object.keys(config.apps)).toHaveLength(5);
			expect(config.apps['payment-service'].dependencies).toEqual([
				'user-service',
			]);
			expect(config.apps['admin-dashboard'].dependencies).toEqual([
				'api-gateway',
				'user-service',
			]);
		});

		it('should handle empty dependencies array', () => {
			const config = defineWorkspace({
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
						dependencies: [],
					},
				},
			});

			expect(config.apps.api.dependencies).toEqual([]);
		});

		it('should handle undefined dependencies', () => {
			const config = defineWorkspace({
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
					},
				},
			});

			expect(config.apps.api.dependencies).toBeUndefined();
		});
	});
});
