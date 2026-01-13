import { describe, expect, it } from 'vitest';
import {
	formatValidationErrors,
	safeValidateWorkspaceConfig,
	validateWorkspaceConfig,
} from '../schema.ts';

describe('WorkspaceConfigSchema', () => {
	describe('validateWorkspaceConfig', () => {
		it('should validate a minimal valid workspace config', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: './src/endpoints/**/*.ts',
					},
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.apps.api).toMatchObject({
				type: 'backend',
				path: 'apps/api',
				port: 3000,
				routes: './src/endpoints/**/*.ts',
			});
		});

		it('should validate a complete workspace config', () => {
			const config = {
				name: 'my-saas',
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: './src/endpoints/**/*.ts',
						envParser: './src/config/env',
						logger: './src/logger',
						telescope: true,
						openapi: { enabled: true, title: 'My API' },
					},
					web: {
						type: 'frontend' as const,
						path: 'apps/web',
						port: 3001,
						framework: 'nextjs' as const,
						dependencies: ['api'],
						client: { output: './src/api' },
					},
				},
				shared: {
					packages: ['packages/*'],
					models: { path: 'packages/models', schema: 'zod' as const },
				},
				deploy: {
					default: 'dokploy' as const,
					dokploy: {
						endpoint: 'https://dokploy.example.com',
						projectId: 'proj-123',
					},
				},
				services: {
					db: true,
					cache: { version: '7.2', image: 'redis:7.2-alpine' },
					mail: { smtp: { host: 'smtp.example.com', port: 587 } },
				},
				secrets: {
					enabled: true,
					algorithm: 'aes-256-gcm',
					kdf: 'scrypt' as const,
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.name).toBe('my-saas');
			expect(result.apps.api.type).toBe('backend');
			expect(result.apps.web.type).toBe('frontend');
			expect(result.apps.web.dependencies).toEqual(['api']);
			expect(result.shared?.packages).toEqual(['packages/*']);
			expect(result.deploy?.default).toBe('dokploy');
			expect(result.services?.db).toBe(true);
		});

		it('should default app type to backend', () => {
			const config = {
				apps: {
					api: {
						path: 'apps/api',
						port: 3000,
						routes: './src/endpoints/**/*.ts',
					},
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.apps.api.type).toBe('backend');
		});

		it('should accept array of route globs', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: ['./src/endpoints/**/*.ts', './src/routes/**/*.ts'],
					},
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.apps.api.routes).toEqual([
				'./src/endpoints/**/*.ts',
				'./src/routes/**/*.ts',
			]);
		});
	});

	describe('validation errors', () => {
		it('should reject config without apps', () => {
			const config = { name: 'test' };

			expect(() => validateWorkspaceConfig(config)).toThrow();
		});

		it('should reject empty apps object', () => {
			const config = { apps: {} };

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it('should reject backend app without routes', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						// Missing routes
					},
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
		});

		it('should reject frontend app without framework', () => {
			const config = {
				apps: {
					web: {
						type: 'frontend' as const,
						path: 'apps/web',
						port: 3001,
						// Missing framework
					},
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
		});

		it('should reject invalid port', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: -1,
						routes: './src/**/*.ts',
					},
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
		});

		it('should reject dependency referencing non-existent app', () => {
			const config = {
				apps: {
					web: {
						type: 'frontend' as const,
						path: 'apps/web',
						port: 3001,
						framework: 'nextjs' as const,
						dependencies: ['nonexistent'],
					},
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
		});

		it('should reject self-referential dependency', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
						dependencies: ['api'],
					},
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
		});

		it('should reject circular dependencies', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
						dependencies: ['worker'],
					},
					worker: {
						type: 'backend' as const,
						path: 'apps/worker',
						port: 3001,
						routes: './src/**/*.ts',
						dependencies: ['api'],
					},
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
		});

		it('should reject invalid dokploy endpoint URL', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
					},
				},
				deploy: {
					dokploy: {
						endpoint: 'not-a-url',
						projectId: 'proj-123',
					},
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
		});
	});

	describe('formatValidationErrors', () => {
		it('should format errors with paths', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: '',
						port: 3000,
						routes: './src/**/*.ts',
					},
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
			if (result.error) {
				const formatted = formatValidationErrors(result.error);
				expect(formatted).toContain('Workspace configuration validation failed');
			}
		});

		it('should format root-level errors', () => {
			const config = { apps: {} };

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
			if (result.error) {
				const formatted = formatValidationErrors(result.error);
				expect(formatted).toContain('At least one app must be defined');
			}
		});
	});

	describe('telescope configuration', () => {
		it('should accept boolean telescope config', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
						telescope: true,
					},
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.apps.api.telescope).toBe(true);
		});

		it('should accept string telescope config', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
						telescope: './src/telescope',
					},
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.apps.api.telescope).toBe('./src/telescope');
		});

		it('should accept object telescope config', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
						telescope: {
							enabled: true,
							port: 9000,
							path: '/__debug',
							ignore: ['/health'],
							recordBody: false,
							maxEntries: 500,
							websocket: true,
						},
					},
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.apps.api.telescope).toEqual({
				enabled: true,
				port: 9000,
				path: '/__debug',
				ignore: ['/health'],
				recordBody: false,
				maxEntries: 500,
				websocket: true,
			});
		});
	});

	describe('deploy configuration', () => {
		it('should accept per-app deploy override', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
						deploy: 'vercel' as const,
					},
					web: {
						type: 'frontend' as const,
						path: 'apps/web',
						port: 3001,
						framework: 'nextjs' as const,
						deploy: 'cloudflare' as const,
					},
				},
				deploy: {
					default: 'dokploy' as const,
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.apps.api.deploy).toBe('vercel');
			expect(result.apps.web.deploy).toBe('cloudflare');
			expect(result.deploy?.default).toBe('dokploy');
		});
	});
});
