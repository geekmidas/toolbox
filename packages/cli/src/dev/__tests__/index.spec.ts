import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
	NormalizedAppConfig,
	NormalizedWorkspace,
} from '../../workspace/index.js';
import {
	checkPortConflicts,
	findAvailablePort,
	generateAllDependencyEnvVars,
	isPortAvailable,
	loadSecretsForApp,
	normalizeHooksConfig,
	normalizeProductionConfig,
	normalizeStudioConfig,
	normalizeTelescopeConfig,
	validateFrontendApp,
	validateFrontendApps,
} from '../index';

// Skip port-related tests in CI due to flaky port binding issues
const describePortTests = process.env.CI ? describe.skip : describe;

// Track servers to clean up after each test
const activeServers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
	// Close all servers and wait for them to fully close
	await Promise.all(
		activeServers.map(
			(server) =>
				new Promise<void>((resolve) => {
					server.close(() => resolve());
				}),
		),
	);
	activeServers.length = 0;
	// Give OS time to release ports
	await new Promise((resolve) => setTimeout(resolve, 50));
});

/**
 * Helper to occupy a port for testing.
 * Pass port 0 to get a random available port.
 */
function occupyPort(
	port: number,
): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
	return new Promise((resolve, reject) => {
		const server = createServer();

		server.once('error', (err) => {
			reject(err);
		});

		server.once('listening', () => {
			activeServers.push(server);
			const actualPort = (server.address() as AddressInfo).port;
			resolve({ server, port: actualPort });
		});

		server.listen(port);
	});
}

describePortTests('Port Availability Functions', () => {
	describe('isPortAvailable', () => {
		it('should return true for an available port', async () => {
			// Get a random port, close it, then check availability
			const { server, port } = await occupyPort(0);
			server.close();
			await new Promise((resolve) => setTimeout(resolve, 50));

			const available = await isPortAvailable(port);
			expect(available).toBe(true);
		});

		it('should return false for a port in use', async () => {
			const { port } = await occupyPort(0);

			const available = await isPortAvailable(port);
			expect(available).toBe(false);
			// Server cleanup handled by afterEach
		});

		it('should handle multiple sequential checks correctly', async () => {
			// Get a port to test with
			const { server: tempServer, port } = await occupyPort(0);
			tempServer.close();
			await new Promise((resolve) => setTimeout(resolve, 50));

			// First check - port should be available
			const firstCheck = await isPortAvailable(port);
			expect(firstCheck).toBe(true);

			// Occupy the port
			await occupyPort(port);

			// Second check - port should be unavailable
			const secondCheck = await isPortAvailable(port);
			expect(secondCheck).toBe(false);
			// Server cleanup and third check handled by afterEach
		});
	});

	describe('findAvailablePort', () => {
		it('should return the preferred port if available', async () => {
			// Get a random port, close it, then use as preferred
			const { server, port: preferredPort } = await occupyPort(0);
			server.close();
			await new Promise((resolve) => setTimeout(resolve, 50));

			const foundPort = await findAvailablePort(preferredPort);
			expect(foundPort).toBe(preferredPort);
		});

		it('should return the next available port if preferred is in use', async () => {
			const { port: preferredPort } = await occupyPort(0);

			const foundPort = await findAvailablePort(preferredPort);
			expect(foundPort).toBe(preferredPort + 1);
		});

		it('should skip multiple occupied ports', async () => {
			// Get a base port
			const { port: basePort } = await occupyPort(0);
			// Occupy consecutive ports
			await occupyPort(basePort + 1);
			await occupyPort(basePort + 2);

			const foundPort = await findAvailablePort(basePort);
			expect(foundPort).toBe(basePort + 3);
		});

		it('should throw error if no available port found within max attempts', async () => {
			const { port: preferredPort } = await occupyPort(0);
			const maxAttempts = 3;

			// Occupy consecutive ports
			await occupyPort(preferredPort + 1);
			await occupyPort(preferredPort + 2);

			await expect(
				findAvailablePort(preferredPort, maxAttempts),
			).rejects.toThrow(
				`Could not find an available port after trying ${maxAttempts} ports starting from ${preferredPort}`,
			);
		});

		it('should respect custom maxAttempts parameter', async () => {
			const { port: preferredPort } = await occupyPort(0);
			const maxAttempts = 5;

			// Occupy consecutive ports (4 total including base)
			await occupyPort(preferredPort + 1);
			await occupyPort(preferredPort + 2);
			await occupyPort(preferredPort + 3);

			const foundPort = await findAvailablePort(preferredPort, maxAttempts);
			// Should find port at preferredPort + 4 (within 5 attempts)
			expect(foundPort).toBe(preferredPort + 4);
		});
	});
});

describePortTests('DevServer', () => {
	describe('port selection', () => {
		it('should use requested port when available', async () => {
			// Get a random port, close it, then use as requested
			const { server, port: requestedPort } = await occupyPort(0);
			server.close();
			await new Promise((resolve) => setTimeout(resolve, 50));

			const actualPort = await findAvailablePort(requestedPort);
			expect(actualPort).toBe(requestedPort);
		});

		it('should select alternative port when requested is in use', async () => {
			const { port: requestedPort } = await occupyPort(0);

			const actualPort = await findAvailablePort(requestedPort);
			expect(actualPort).not.toBe(requestedPort);
			expect(actualPort).toBeGreaterThan(requestedPort);
			expect(actualPort).toBeLessThanOrEqual(requestedPort + 10);
		});
	});
});

describePortTests('devCommand edge cases', () => {
	it('should handle port conflicts gracefully', async () => {
		const { port } = await occupyPort(0);

		// The dev command should find an alternative port
		const alternativePort = await findAvailablePort(port);
		expect(alternativePort).toBeGreaterThan(port);
	});

	it('should handle concurrent port checks', async () => {
		// Get three random available ports as base
		const { server: s1, port: p1 } = await occupyPort(0);
		const { server: s2, port: p2 } = await occupyPort(0);
		const { server: s3, port: p3 } = await occupyPort(0);
		s1.close();
		s2.close();
		s3.close();
		await new Promise((resolve) => setTimeout(resolve, 50));

		// Run multiple port checks concurrently
		const results = await Promise.all([
			findAvailablePort(p1),
			findAvailablePort(p2),
			findAvailablePort(p3),
		]);

		// All should succeed and return valid ports
		expect(results).toHaveLength(3);
		expect(results[0]).toBe(p1);
		expect(results[1]).toBe(p2);
		expect(results[2]).toBe(p3);
	});
});

describe('normalizeTelescopeConfig', () => {
	it('should return undefined when config is false', () => {
		const result = normalizeTelescopeConfig(false);
		expect(result).toBeUndefined();
	});

	it('should return default config when config is true', () => {
		const result = normalizeTelescopeConfig(true);
		expect(result).toEqual({
			enabled: true,
			path: '/__telescope',
			ignore: [],
			recordBody: true,
			maxEntries: 1000,
			websocket: true,
		});
	});

	it('should return default config when config is undefined', () => {
		const result = normalizeTelescopeConfig(undefined);
		expect(result).toEqual({
			enabled: true,
			path: '/__telescope',
			ignore: [],
			recordBody: true,
			maxEntries: 1000,
			websocket: true,
		});
	});

	it('should return undefined when config.enabled is false', () => {
		const result = normalizeTelescopeConfig({ enabled: false });
		expect(result).toBeUndefined();
	});

	it('should merge custom config with defaults', () => {
		const result = normalizeTelescopeConfig({
			path: '/__debug',
			ignore: ['/health', '/metrics'],
			recordBody: false,
			maxEntries: 500,
		});
		expect(result).toEqual({
			enabled: true,
			path: '/__debug',
			ignore: ['/health', '/metrics'],
			recordBody: false,
			maxEntries: 500,
			websocket: true,
		});
	});

	it('should use defaults for missing config values', () => {
		const result = normalizeTelescopeConfig({
			path: '/__custom',
		});
		expect(result).toEqual({
			enabled: true,
			path: '/__custom',
			ignore: [],
			recordBody: true,
			maxEntries: 1000,
			websocket: true,
		});
	});

	it('should handle empty object config', () => {
		const result = normalizeTelescopeConfig({});
		expect(result).toEqual({
			enabled: true,
			path: '/__telescope',
			ignore: [],
			recordBody: true,
			maxEntries: 1000,
			websocket: true,
		});
	});

	it('should allow disabling websocket', () => {
		const result = normalizeTelescopeConfig({
			websocket: false,
		});
		expect(result).toEqual({
			enabled: true,
			path: '/__telescope',
			ignore: [],
			recordBody: true,
			maxEntries: 1000,
			websocket: false,
		});
	});
});

describe('normalizeStudioConfig', () => {
	it('should return undefined when config is false', () => {
		const result = normalizeStudioConfig(false);
		expect(result).toBeUndefined();
	});

	it('should return default config when config is true', () => {
		const result = normalizeStudioConfig(true);
		expect(result).toEqual({
			enabled: true,
			path: '/__studio',
			schema: 'public',
		});
	});

	it('should return default config when config is undefined', () => {
		const result = normalizeStudioConfig(undefined);
		expect(result).toEqual({
			enabled: true,
			path: '/__studio',
			schema: 'public',
		});
	});

	it('should return undefined when config.enabled is false', () => {
		const result = normalizeStudioConfig({ enabled: false });
		expect(result).toBeUndefined();
	});

	it('should merge custom config with defaults', () => {
		const result = normalizeStudioConfig({
			path: '/__db',
			schema: 'custom_schema',
		});
		expect(result).toEqual({
			enabled: true,
			path: '/__db',
			schema: 'custom_schema',
		});
	});
});

describe('normalizeHooksConfig', () => {
	it('should return undefined when no hooks configured', () => {
		const result = normalizeHooksConfig(undefined);
		expect(result).toBeUndefined();
	});

	it('should return undefined when server hook not configured', () => {
		const result = normalizeHooksConfig({});
		expect(result).toBeUndefined();
	});

	it('should return path when server hook is configured', () => {
		const result = normalizeHooksConfig({ server: './src/hooks' });
		expect(result).toBeDefined();
		expect(result?.serverHooksPath).toContain('src/hooks.ts');
	});

	it('should handle .ts extension in path', () => {
		const result = normalizeHooksConfig({ server: './src/hooks.ts' });
		expect(result).toBeDefined();
		expect(result?.serverHooksPath).toContain('src/hooks.ts');
	});
});

describe('normalizeProductionConfig', () => {
	it('should return undefined when cliProduction is false', () => {
		const result = normalizeProductionConfig(false);
		expect(result).toBeUndefined();
	});

	it('should return undefined when cliProduction is false even with config', () => {
		const result = normalizeProductionConfig(false, { bundle: true });
		expect(result).toBeUndefined();
	});

	it('should return default config when cliProduction is true', () => {
		const result = normalizeProductionConfig(true);
		expect(result).toBeDefined();
		expect(result?.enabled).toBe(true);
		expect(result?.bundle).toBe(true);
	});

	it('should merge custom config with defaults', () => {
		const result = normalizeProductionConfig(true, { bundle: false });
		expect(result).toBeDefined();
		expect(result?.enabled).toBe(true);
		expect(result?.bundle).toBe(false);
	});
});

describe('Workspace Dev Server', () => {
	/**
	 * Helper to create a test workspace configuration.
	 * Automatically adds resolvedDeployTarget to each app.
	 */
	function createTestWorkspace(
		apps: Record<string, Omit<NormalizedAppConfig, 'resolvedDeployTarget'>>,
		overrides: Partial<NormalizedWorkspace> = {},
	): NormalizedWorkspace {
		const appsWithDeployTarget: NormalizedWorkspace['apps'] = {};
		for (const [name, app] of Object.entries(apps)) {
			appsWithDeployTarget[name] = {
				...app,
				resolvedDeployTarget: 'dokploy',
			};
		}
		return {
			name: 'test-workspace',
			root: '/test/workspace',
			apps: appsWithDeployTarget,
			services: {},
			deploy: { default: 'dokploy' },
			shared: { packages: ['packages/*'] },
			secrets: {},
			...overrides,
		};
	}

	describe('checkPortConflicts', () => {
		it('should return empty array when no conflicts', () => {
			const workspace = createTestWorkspace({
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					dependencies: [],
				},
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3001,
					dependencies: [],
				},
				admin: {
					type: 'frontend',
					path: 'apps/admin',
					port: 3002,
					dependencies: [],
				},
			});

			const conflicts = checkPortConflicts(workspace);
			expect(conflicts).toEqual([]);
		});

		it('should detect port conflicts between two apps', () => {
			const workspace = createTestWorkspace({
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					dependencies: [],
				},
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3000, // Same port as api!
					dependencies: [],
				},
			});

			const conflicts = checkPortConflicts(workspace);
			expect(conflicts).toHaveLength(1);
			expect(conflicts[0]).toEqual({
				app1: 'api',
				app2: 'web',
				port: 3000,
			});
		});

		it('should detect multiple port conflicts', () => {
			const workspace = createTestWorkspace({
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					dependencies: [],
				},
				auth: {
					type: 'backend',
					path: 'apps/auth',
					port: 3000, // Conflicts with api
					dependencies: [],
				},
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3001,
					dependencies: [],
				},
				admin: {
					type: 'frontend',
					path: 'apps/admin',
					port: 3001, // Conflicts with web
					dependencies: [],
				},
			});

			const conflicts = checkPortConflicts(workspace);
			expect(conflicts).toHaveLength(2);
		});

		it('should handle single app workspace', () => {
			const workspace = createTestWorkspace({
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					dependencies: [],
				},
			});

			const conflicts = checkPortConflicts(workspace);
			expect(conflicts).toEqual([]);
		});
	});

	describe('generateAllDependencyEnvVars', () => {
		it('should generate empty object for apps with no dependencies', () => {
			const workspace = createTestWorkspace({
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					dependencies: [],
				},
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3001,
					dependencies: [],
				},
			});

			const env = generateAllDependencyEnvVars(workspace);
			expect(env).toEqual({});
		});

		it('should generate URL env vars for dependencies', () => {
			const workspace = createTestWorkspace({
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					dependencies: [],
				},
				auth: {
					type: 'backend',
					path: 'apps/auth',
					port: 3001,
					dependencies: [],
				},
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3002,
					dependencies: ['api', 'auth'],
				},
			});

			const env = generateAllDependencyEnvVars(workspace);
			expect(env).toEqual({
				API_URL: 'http://localhost:3000',
				AUTH_URL: 'http://localhost:3001',
			});
		});

		it('should handle cross-dependencies between backend apps', () => {
			const workspace = createTestWorkspace({
				'api-gateway': {
					type: 'backend',
					path: 'apps/api-gateway',
					port: 3000,
					dependencies: [],
				},
				'user-service': {
					type: 'backend',
					path: 'apps/user-service',
					port: 3001,
					dependencies: [],
				},
				'order-service': {
					type: 'backend',
					path: 'apps/order-service',
					port: 3002,
					dependencies: ['user-service'],
				},
			});

			const env = generateAllDependencyEnvVars(workspace);
			expect(env).toEqual({
				'USER-SERVICE_URL': 'http://localhost:3001',
			});
		});

		it('should use custom URL prefix', () => {
			const workspace = createTestWorkspace({
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					dependencies: [],
				},
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3001,
					dependencies: ['api'],
				},
			});

			const env = generateAllDependencyEnvVars(workspace, 'http://127.0.0.1');
			expect(env).toEqual({
				API_URL: 'http://127.0.0.1:3000',
			});
		});

		it('should handle complex dependency graph', () => {
			const workspace = createTestWorkspace({
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					dependencies: [],
				},
				auth: {
					type: 'backend',
					path: 'apps/auth',
					port: 3001,
					dependencies: [],
				},
				payments: {
					type: 'backend',
					path: 'apps/payments',
					port: 3002,
					dependencies: ['auth'], // Payments depends on auth
				},
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3003,
					dependencies: ['api', 'auth'], // Web depends on api and auth
				},
				admin: {
					type: 'frontend',
					path: 'apps/admin',
					port: 3004,
					dependencies: ['api', 'payments'], // Admin depends on api and payments
				},
			});

			const env = generateAllDependencyEnvVars(workspace);
			expect(env).toEqual({
				AUTH_URL: 'http://localhost:3001',
				API_URL: 'http://localhost:3000',
				PAYMENTS_URL: 'http://localhost:3002',
			});
		});
	});

	describe('validateFrontendApp', () => {
		let testDir: string;

		beforeEach(() => {
			// Create a unique temp directory for each test
			testDir = join(
				tmpdir(),
				`gkm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			);
			mkdirSync(testDir, { recursive: true });
		});

		afterEach(() => {
			// Clean up temp directory
			if (existsSync(testDir)) {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		it('should validate a properly configured Next.js app', async () => {
			// Create a valid Next.js app structure
			const appDir = join(testDir, 'apps/web');
			mkdirSync(appDir, { recursive: true });

			// Create next.config.js
			writeFileSync(join(appDir, 'next.config.js'), 'module.exports = {}');

			// Create package.json with next dependency
			writeFileSync(
				join(appDir, 'package.json'),
				JSON.stringify({
					name: 'web',
					dependencies: { next: '^14.0.0', react: '^18.0.0' },
					scripts: { dev: 'next dev' },
				}),
			);

			const result = await validateFrontendApp('web', 'apps/web', testDir);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.warnings).toHaveLength(0);
		});

		it('should detect missing Next.js config file', async () => {
			const appDir = join(testDir, 'apps/web');
			mkdirSync(appDir, { recursive: true });

			// Create package.json without next.config.js
			writeFileSync(
				join(appDir, 'package.json'),
				JSON.stringify({
					name: 'web',
					dependencies: { next: '^14.0.0' },
					scripts: { dev: 'next dev' },
				}),
			);

			const result = await validateFrontendApp('web', 'apps/web', testDir);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.stringContaining('Next.js config file not found'),
			);
		});

		it('should detect missing Next.js dependency', async () => {
			const appDir = join(testDir, 'apps/web');
			mkdirSync(appDir, { recursive: true });

			// Create next.config.js
			writeFileSync(join(appDir, 'next.config.js'), 'module.exports = {}');

			// Create package.json WITHOUT next dependency
			writeFileSync(
				join(appDir, 'package.json'),
				JSON.stringify({
					name: 'web',
					dependencies: { react: '^18.0.0' },
					scripts: { dev: 'echo no next' },
				}),
			);

			const result = await validateFrontendApp('web', 'apps/web', testDir);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.stringContaining('Next.js not found in dependencies'),
			);
		});

		it('should detect missing package.json', async () => {
			const appDir = join(testDir, 'apps/web');
			mkdirSync(appDir, { recursive: true });

			// Create next.config.js but no package.json
			writeFileSync(join(appDir, 'next.config.js'), 'module.exports = {}');

			const result = await validateFrontendApp('web', 'apps/web', testDir);

			expect(result.valid).toBe(false);
			expect(result.errors).toContainEqual(
				expect.stringContaining('package.json not found'),
			);
		});

		it('should warn about missing dev script', async () => {
			const appDir = join(testDir, 'apps/web');
			mkdirSync(appDir, { recursive: true });

			writeFileSync(join(appDir, 'next.config.js'), 'module.exports = {}');

			// Create package.json WITHOUT dev script
			writeFileSync(
				join(appDir, 'package.json'),
				JSON.stringify({
					name: 'web',
					dependencies: { next: '^14.0.0' },
					// No scripts
				}),
			);

			const result = await validateFrontendApp('web', 'apps/web', testDir);

			expect(result.valid).toBe(true); // Still valid, just a warning
			expect(result.warnings).toContainEqual(
				expect.stringContaining('No "dev" script found'),
			);
		});

		it('should accept next.config.ts', async () => {
			const appDir = join(testDir, 'apps/web');
			mkdirSync(appDir, { recursive: true });

			// Create next.config.ts (TypeScript config)
			writeFileSync(
				join(appDir, 'next.config.ts'),
				'export default { reactStrictMode: true }',
			);

			writeFileSync(
				join(appDir, 'package.json'),
				JSON.stringify({
					name: 'web',
					dependencies: { next: '^14.0.0' },
					scripts: { dev: 'next dev' },
				}),
			);

			const result = await validateFrontendApp('web', 'apps/web', testDir);

			expect(result.valid).toBe(true);
		});

		it('should accept next.config.mjs', async () => {
			const appDir = join(testDir, 'apps/web');
			mkdirSync(appDir, { recursive: true });

			// Create next.config.mjs (ESM config)
			writeFileSync(
				join(appDir, 'next.config.mjs'),
				'export default { reactStrictMode: true }',
			);

			writeFileSync(
				join(appDir, 'package.json'),
				JSON.stringify({
					name: 'web',
					dependencies: { next: '^14.0.0' },
					scripts: { dev: 'next dev' },
				}),
			);

			const result = await validateFrontendApp('web', 'apps/web', testDir);

			expect(result.valid).toBe(true);
		});

		it('should detect next in devDependencies', async () => {
			const appDir = join(testDir, 'apps/web');
			mkdirSync(appDir, { recursive: true });

			writeFileSync(join(appDir, 'next.config.js'), 'module.exports = {}');

			// Next in devDependencies (valid)
			writeFileSync(
				join(appDir, 'package.json'),
				JSON.stringify({
					name: 'web',
					devDependencies: { next: '^14.0.0' },
					scripts: { dev: 'next dev' },
				}),
			);

			const result = await validateFrontendApp('web', 'apps/web', testDir);

			expect(result.valid).toBe(true);
		});
	});

	describe('validateFrontendApps', () => {
		let testDir: string;

		beforeEach(() => {
			testDir = join(
				tmpdir(),
				`gkm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			);
			mkdirSync(testDir, { recursive: true });
		});

		afterEach(() => {
			if (existsSync(testDir)) {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		it('should validate only frontend apps', async () => {
			// Create valid frontend app
			const webDir = join(testDir, 'apps/web');
			mkdirSync(webDir, { recursive: true });
			writeFileSync(join(webDir, 'next.config.js'), 'module.exports = {}');
			writeFileSync(
				join(webDir, 'package.json'),
				JSON.stringify({
					name: 'web',
					dependencies: { next: '^14.0.0' },
					scripts: { dev: 'next dev' },
				}),
			);

			const workspace: NormalizedWorkspace = {
				name: 'test-workspace',
				root: testDir,
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						resolvedDeployTarget: 'dokploy',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						dependencies: ['api'],
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const results = await validateFrontendApps(workspace);

			// Should only validate the frontend app
			expect(results).toHaveLength(1);
			expect(results[0]?.appName).toBe('web');
			expect(results[0]?.valid).toBe(true);
		});

		it('should return empty array for backend-only workspace', async () => {
			const workspace: NormalizedWorkspace = {
				name: 'test-workspace',
				root: testDir,
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const results = await validateFrontendApps(workspace);

			expect(results).toHaveLength(0);
		});
	});
});

describe('loadSecretsForApp', () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(
			tmpdir(),
			`gkm-secrets-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	/**
	 * Helper to create a secrets file in legacy (unencrypted) format.
	 * This matches the StageSecrets structure.
	 */
	function createSecretsFile(
		stage: string,
		secrets: Record<string, string>,
		root = testDir,
	) {
		const secretsDir = join(root, '.gkm', 'secrets');
		mkdirSync(secretsDir, { recursive: true });
		const stageSecrets = {
			stage,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			services: {},
			urls: {},
			custom: secrets,
		};
		writeFileSync(
			join(secretsDir, `${stage}.json`),
			JSON.stringify(stageSecrets, null, 2),
		);
	}

	describe('single app mode (no appName)', () => {
		it('should return secrets as-is without mapping', async () => {
			createSecretsFile('development', {
				DATABASE_URL: 'postgresql://localhost/mydb',
				JWT_SECRET: 'super-secret',
				NODE_ENV: 'development',
			});

			const secrets = await loadSecretsForApp(testDir);

			expect(secrets).toEqual({
				DATABASE_URL: 'postgresql://localhost/mydb',
				JWT_SECRET: 'super-secret',
				NODE_ENV: 'development',
			});
		});

		it('should try dev stage first, then development', async () => {
			createSecretsFile('dev', {
				DATABASE_URL: 'postgresql://localhost/devdb',
			});
			createSecretsFile('development', {
				DATABASE_URL: 'postgresql://localhost/developmentdb',
			});

			const secrets = await loadSecretsForApp(testDir);

			// Should use 'dev' stage since it's checked first
			expect(secrets.DATABASE_URL).toBe('postgresql://localhost/devdb');
		});

		it('should fallback to development if dev does not exist', async () => {
			createSecretsFile('development', {
				DATABASE_URL: 'postgresql://localhost/developmentdb',
			});

			const secrets = await loadSecretsForApp(testDir);

			expect(secrets.DATABASE_URL).toBe('postgresql://localhost/developmentdb');
		});

		it('should return empty object if no secrets exist', async () => {
			const secrets = await loadSecretsForApp(testDir);

			expect(secrets).toEqual({});
		});
	});

	describe('workspace app mode (with appName)', () => {
		it('should map {APP}_DATABASE_URL to DATABASE_URL', async () => {
			createSecretsFile('development', {
				AUTH_DATABASE_URL: 'postgresql://auth_user:pass@localhost/authdb',
				API_DATABASE_URL: 'postgresql://api_user:pass@localhost/apidb',
				JWT_SECRET: 'shared-secret',
			});

			const authSecrets = await loadSecretsForApp(testDir, 'auth');

			expect(authSecrets.DATABASE_URL).toBe(
				'postgresql://auth_user:pass@localhost/authdb',
			);
			// Original prefixed secrets are also available
			expect(authSecrets.AUTH_DATABASE_URL).toBe(
				'postgresql://auth_user:pass@localhost/authdb',
			);
			expect(authSecrets.JWT_SECRET).toBe('shared-secret');
		});

		it('should map API secrets correctly', async () => {
			createSecretsFile('development', {
				AUTH_DATABASE_URL: 'postgresql://auth_user:pass@localhost/authdb',
				API_DATABASE_URL: 'postgresql://api_user:pass@localhost/apidb',
			});

			const apiSecrets = await loadSecretsForApp(testDir, 'api');

			expect(apiSecrets.DATABASE_URL).toBe(
				'postgresql://api_user:pass@localhost/apidb',
			);
		});

		it('should not override DATABASE_URL if no prefixed version exists', async () => {
			createSecretsFile('development', {
				DATABASE_URL: 'postgresql://localhost/maindb',
				JWT_SECRET: 'secret',
			});

			// Asking for 'auth' app but AUTH_DATABASE_URL doesn't exist
			const authSecrets = await loadSecretsForApp(testDir, 'auth');

			// Should keep the original DATABASE_URL since there's no AUTH_DATABASE_URL
			expect(authSecrets.DATABASE_URL).toBe('postgresql://localhost/maindb');
		});

		it('should handle uppercase app names in secrets', async () => {
			createSecretsFile('development', {
				MYSERVICE_DATABASE_URL: 'postgresql://localhost/myservicedb',
			});

			// App name is lowercase but secrets are uppercase prefixed
			const secrets = await loadSecretsForApp(testDir, 'myservice');

			expect(secrets.DATABASE_URL).toBe('postgresql://localhost/myservicedb');
		});

		it('should return empty object if no secrets exist for app', async () => {
			const secrets = await loadSecretsForApp(testDir, 'api');

			expect(secrets).toEqual({});
		});
	});

	describe('service credentials mapping', () => {
		it('should include postgres service credentials', async () => {
			const secretsDir = join(testDir, '.gkm', 'secrets');
			mkdirSync(secretsDir, { recursive: true });
			const stageSecrets = {
				stage: 'development',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				services: {
					postgres: {
						username: 'postgres',
						password: 'postgres123',
						database: 'myapp',
						host: 'localhost',
						port: 5432,
					},
				},
				urls: {},
				custom: { NODE_ENV: 'development' },
			};
			writeFileSync(
				join(secretsDir, 'development.json'),
				JSON.stringify(stageSecrets, null, 2),
			);

			const secrets = await loadSecretsForApp(testDir);

			expect(secrets.POSTGRES_USER).toBe('postgres');
			expect(secrets.POSTGRES_PASSWORD).toBe('postgres123');
			expect(secrets.POSTGRES_DB).toBe('myapp');
			expect(secrets.POSTGRES_HOST).toBe('localhost');
			expect(secrets.POSTGRES_PORT).toBe('5432');
			expect(secrets.NODE_ENV).toBe('development');
		});

		it('should include redis service credentials', async () => {
			const secretsDir = join(testDir, '.gkm', 'secrets');
			mkdirSync(secretsDir, { recursive: true });
			const stageSecrets = {
				stage: 'development',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				services: {
					redis: {
						password: 'redis123',
						host: 'localhost',
						port: 6379,
					},
				},
				urls: {},
				custom: {},
			};
			writeFileSync(
				join(secretsDir, 'development.json'),
				JSON.stringify(stageSecrets, null, 2),
			);

			const secrets = await loadSecretsForApp(testDir);

			expect(secrets.REDIS_PASSWORD).toBe('redis123');
			expect(secrets.REDIS_HOST).toBe('localhost');
			expect(secrets.REDIS_PORT).toBe('6379');
		});
	});
});
