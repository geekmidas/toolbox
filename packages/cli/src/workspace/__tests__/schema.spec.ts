import { describe, expect, it } from 'vitest';
import {
	formatValidationErrors,
	getDeployTargetError,
	isDeployTargetSupported,
	isPhase2DeployTarget,
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

		it('should allow backend app without routes (e.g., auth servers)', () => {
			const config = {
				apps: {
					auth: {
						type: 'backend' as const,
						path: 'apps/auth',
						port: 3000,
						// Routes are optional for backend apps
					},
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(true);
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
				expect(formatted).toContain(
					'Workspace configuration validation failed',
				);
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
		it('should accept dokploy as per-app deploy target', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
						deploy: 'dokploy' as const,
					},
				},
				deploy: {
					default: 'dokploy' as const,
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.apps.api.deploy).toBe('dokploy');
			expect(result.deploy?.default).toBe('dokploy');
		});

		it('should reject Phase 2 deploy target in deploy.default', () => {
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
					default: 'vercel' as const,
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
			if (result.error) {
				const formatted = formatValidationErrors(result.error);
				expect(formatted).toContain('coming in Phase 2');
			}
		});

		it('should reject Phase 2 deploy target in per-app deploy', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
						deploy: 'cloudflare' as const,
					},
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
			if (result.error) {
				const formatted = formatValidationErrors(result.error);
				expect(formatted).toContain('coming in Phase 2');
				expect(formatted).toContain('api');
			}
		});

		it('should reject unknown deploy target', () => {
			const config = {
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
						deploy: 'kubernetes' as const,
					},
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
		});
	});

	describe('auth app configuration', () => {
		it('should accept auth app with provider', () => {
			const config = {
				apps: {
					auth: {
						type: 'auth' as const,
						path: 'apps/auth',
						port: 3002,
						provider: 'better-auth' as const,
					},
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.apps.auth.type).toBe('auth');
			expect(result.apps.auth.provider).toBe('better-auth');
		});

		it('should reject auth app without provider', () => {
			const config = {
				apps: {
					auth: {
						type: 'auth' as const,
						path: 'apps/auth',
						port: 3002,
						// Missing provider
					},
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
			if (result.error) {
				const formatted = formatValidationErrors(result.error);
				expect(formatted).toContain('Auth apps must have provider defined');
			}
		});

		it('should allow auth app with backend properties', () => {
			const config = {
				apps: {
					auth: {
						type: 'auth' as const,
						path: 'apps/auth',
						port: 3002,
						provider: 'better-auth' as const,
						envParser: './src/config/env',
						logger: './src/logger',
						telescope: true,
					},
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.apps.auth.type).toBe('auth');
			expect(result.apps.auth.envParser).toBe('./src/config/env');
			expect(result.apps.auth.telescope).toBe(true);
		});

		it('should validate fullstack workspace with auth app', () => {
			const config = {
				name: 'fullstack-app',
				apps: {
					api: {
						type: 'backend' as const,
						path: 'apps/api',
						port: 3000,
						routes: './src/endpoints/**/*.ts',
						dependencies: ['auth'],
					},
					auth: {
						type: 'auth' as const,
						path: 'apps/auth',
						port: 3002,
						provider: 'better-auth' as const,
					},
					web: {
						type: 'frontend' as const,
						path: 'apps/web',
						port: 3001,
						framework: 'nextjs' as const,
						dependencies: ['api', 'auth'],
					},
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.apps.api.dependencies).toEqual(['auth']);
			expect(result.apps.auth.type).toBe('auth');
			expect(result.apps.web.dependencies).toEqual(['api', 'auth']);
		});

		it('should reject invalid auth provider', () => {
			const config = {
				apps: {
					auth: {
						type: 'auth' as const,
						path: 'apps/auth',
						port: 3002,
						provider: 'invalid-provider',
					},
				},
			};

			const result = safeValidateWorkspaceConfig(config);

			expect(result.success).toBe(false);
		});
	});

	describe('DNS configuration', () => {
		it('should accept multi-domain DNS config', () => {
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
					default: 'dokploy' as const,
					dns: {
						'geekmidas.dev': { provider: 'hostinger' as const },
						'geekmidas.com': {
							provider: 'route53' as const,
							region: 'us-east-1' as const,
						},
					},
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.deploy?.dns).toEqual({
				'geekmidas.dev': { provider: 'hostinger' },
				'geekmidas.com': { provider: 'route53', region: 'us-east-1' },
			});
		});

		it('should accept legacy single-domain DNS config', () => {
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
					default: 'dokploy' as const,
					dns: {
						provider: 'hostinger' as const,
						domain: 'example.com',
					},
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.deploy?.dns).toEqual({
				provider: 'hostinger',
				domain: 'example.com',
			});
		});

		it('should accept DNS config with manual provider', () => {
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
					default: 'dokploy' as const,
					dns: {
						'example.com': { provider: 'manual' as const },
					},
				},
			};

			const result = validateWorkspaceConfig(config);

			expect(result.deploy?.dns).toEqual({
				'example.com': { provider: 'manual' },
			});
		});

		it('should accept DNS config with TTL', () => {
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
					default: 'dokploy' as const,
					dns: {
						'example.com': { provider: 'hostinger' as const, ttl: 600 },
					},
				},
			};

			const result = validateWorkspaceConfig(config);

			expect((result.deploy?.dns as any)['example.com'].ttl).toBe(600);
		});
	});

	describe('deploy target helpers', () => {
		it('isDeployTargetSupported should return true for dokploy', () => {
			expect(isDeployTargetSupported('dokploy')).toBe(true);
		});

		it('isDeployTargetSupported should return false for Phase 2 targets', () => {
			expect(isDeployTargetSupported('vercel')).toBe(false);
			expect(isDeployTargetSupported('cloudflare')).toBe(false);
		});

		it('isPhase2DeployTarget should identify Phase 2 targets', () => {
			expect(isPhase2DeployTarget('vercel')).toBe(true);
			expect(isPhase2DeployTarget('cloudflare')).toBe(true);
			expect(isPhase2DeployTarget('dokploy')).toBe(false);
			expect(isPhase2DeployTarget('unknown')).toBe(false);
		});

		it('getDeployTargetError should return Phase 2 message', () => {
			const error = getDeployTargetError('vercel');
			expect(error).toContain('coming in Phase 2');
			expect(error).toContain('vercel');
			expect(error).toContain('dokploy');
		});

		it('getDeployTargetError should include app name when provided', () => {
			const error = getDeployTargetError('cloudflare', 'web');
			expect(error).toContain('coming in Phase 2');
			expect(error).toContain('cloudflare');
			expect(error).toContain('web');
		});

		it('getDeployTargetError should handle unknown targets', () => {
			const error = getDeployTargetError('kubernetes');
			expect(error).toContain('Unknown deploy target');
			expect(error).toContain('kubernetes');
			expect(error).toContain('Coming in Phase 2');
		});
	});
});
